// Finder (One UI's Finder with Galaxy AI-style answers): one search box for apps, Settings (every section and row),
// your sites, notes/reminders/events and the other apps' content, bookmarks and history; instant answers (maths, units,
// time in a city, dates); quick commands in English and Arabic (timer, Focus, note, remind me, events, wallpaper,
// ambient sounds, theme, the apps' own through registerCommand); on-device AI answers with Chrome's Prompt API
// (js/shell/ai.js) and on-device voice input (js/interpreter/speech.js); the web and your AI assistant.
// Parsers live in js/shell/nlp.js; maths and units come from the engine the Calculator shares (js/calc/engine.js,
// js/calc/units.js). All three load with the first search.
import { h, $, uid, toUrl, hostname, faviconUrl, escapeHtml, isExt, startOfDay } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, addStrings, fmtTime, fmtDate, locale, lang, use12h } from '../core/i18n.js';
import { store, setting, setSetting, trackUsage } from '../core/store.js';
import { getApps, appName, appIconEl, openApp } from '../core/apps.js';
import { scheduleAt } from '../core/schedule.js';
import { toast } from '../core/ui.js';
import { allItems } from './home.js';
import { itemIconEl, itemLabel, openItem, openUrl } from './appicon.js';
import { startFocus, torch } from './quickpanel.js';
import { PRESETS } from './wallpaper.js';
import { SOUNDS, play as playSound, pause as pauseSound, state as soundState } from './sounds.js';
import { runCommands } from '../core/hooks.js';

export const ENGINES = {
  default: { name: 'finder.engineDefault' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  yahoo: { name: 'Yahoo', url: 'https://search.yahoo.com/search?p=%s' },
};

export const ASSISTANTS = {
  claude: { name: 'Claude', url: 'https://claude.ai/new?q=%s' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/?q=%s' },
  perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/search?q=%s' },
  copilot: { name: 'Copilot', url: 'https://copilot.microsoft.com/?q=%s' },
};

let el, input, list, chips, micBtn, askChip, open = false, sel = 0, results = [], seq = 0, aiMode = false;
// the parsers and the maths engine load with the first search, so the Home screen boots without them
let N = null, C = null, libsP = null;
const libs = () => (libsP ||= Promise.all([import('./nlp.js'), import('../calc/engine.js'), import('../calc/units.js')]).then(([n, e, u]) => ((N = n), (C = { ...e, ...u }))));
let local = 'unavailable'; // on-device AI: 'available' | 'downloadable' | 'downloading' | 'unavailable'
let chat = null; // the on-device answer card while it's shown: { el, thread, ctrl }
let listening = null, speech = null;

export function initFinder() {
  el = $('#finder');
  input = h('input', { class: 'finder-input', type: 'text', placeholder: t('finder.placeholder'), 'aria-label': t('finder.placeholder'), autocomplete: 'off', spellcheck: 'false', dir: 'auto' });
  askChip = h('button', { class: 'finder-ask', hidden: true, title: t('finder.askLocalTip'), onClick: () => input.value.trim() && answerLocal(input.value.trim()) },
    h('span', { class: 'finder-ask-ico', html: icon('sparkle', 16) }), t('finder.ask'));
  micBtn = h('button', { class: 'finder-mic', hidden: true, title: t('finder.voice'), 'aria-label': t('finder.voice'), html: icon('mic', 22), onClick: () => toggleMic() });
  const aiBtn = h('button', { class: 'finder-ai', title: t('finder.askAi', { ai: aiName() }), 'aria-label': t('finder.askAi', { ai: aiName() }), html: icon('sparkle', 22), onClick: () => setAi(!aiMode) });
  list = h('div', { class: 'finder-results scroll', role: 'listbox' });
  chips = h('div', { class: 'finder-hints' });
  const panel = h('div', { class: 'finder-panel' },
    h('div', { class: 'finder-bar' }, h('span', { class: 'finder-glass', html: icon('search', 22) }), input, askChip, micBtn, aiBtn),
    chips,
    list);
  el.replaceChildren(panel);
  el.addEventListener('pointerdown', (e) => e.target === el && closeFinder());
  input.addEventListener('input', () => update());
  input.addEventListener('keydown', onKey);
}

const aiName = () => ASSISTANTS[setting('aiAssistant')]?.name || 'AI';
/** On-device answers are on (Settings › Search and Finder) and Chrome can run the model here. */
const localOn = () => setting('finderLocalAi') !== false && local !== 'unavailable' && !!globalThis.LanguageModel;

function setAi(on) {
  aiMode = on;
  if (!on && chat) endChat(false);
  el.classList.toggle('ai', on);
  placeholder();
  update();
  input.focus();
}
function placeholder() {
  input.placeholder = listening ? t('finder.listening') : chat ? t('finder.followUp') : aiMode ? t('finder.askPlaceholder', { ai: localOn() ? t('finder.onDeviceAi') : aiName() }) : t('finder.placeholder');
}

export function openFinder(text = '', { ai = false } = {}) {
  if (document.body.classList.contains('locked')) return;
  import('./drawer.js').then((m) => m.closeDrawer(true));
  open = true;
  if (chat) endChat(false);
  input.value = text;
  el.classList.add('show');
  document.body.classList.add('finder-open');
  setAi(ai);
  libs().catch(() => {});
  refreshAi(false);
  refreshMic();
  // Settings rows are indexed in the background so the first search finds them
  (window.requestIdleCallback || setTimeout)(() => import('../apps/settings.js').then((m) => m.indexSettings?.()).catch(() => {}));
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

export function closeFinder() {
  if (!open) return;
  open = false;
  if (listening) listening.abort?.();
  if (chat) endChat(false);
  el.classList.remove('show');
  document.body.classList.remove('finder-open');
  input.blur();
}

export const isFinderOpen = () => open;

function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (listening) listening.stop();
    else if (input.value) {
      input.value = '';
      update();
    } else if (chat) endChat();
    else closeFinder();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(1, results.length);
    paintSel();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const q = input.value.trim();
    if (chat && q) answerLocal(q);
    else results[sel]?.run(e);
  } else if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) setAi(!aiMode);
    else if (localOn()) answerLocal(q);
    else askAi(q, e);
  }
}

function paintSel() {
  [...list.querySelectorAll('.fr')].forEach((r, i) => {
    r.classList.toggle('sel', i === sel);
    if (i === sel) r.scrollIntoView({ block: 'nearest' });
  });
}

// ——— actions ———
export function webSearch(text, e) {
  trackUsage('search');
  const eng = ENGINES[setting('searchEngine')];
  closeFinder();
  if (!eng?.url && isExt && chrome.search?.query) {
    const newTab = e && (e.ctrlKey || e.metaKey || setting('openLinks') === 'new');
    return chrome.search.query({ text, disposition: newTab ? 'NEW_TAB' : 'CURRENT_TAB' });
  }
  openUrl((eng?.url || ENGINES.google.url).replace('%s', encodeURIComponent(text)), e);
}

function askAi(text, e) {
  closeFinder();
  openUrl((ASSISTANTS[setting('aiAssistant')] || ASSISTANTS.claude).url.replace('%s', encodeURIComponent(text)), e);
}

const copy = (text) => {
  navigator.clipboard?.writeText(String(text)).catch(() => {});
  toast(t('finder.copied'));
};

// ——— on-device AI (Chrome's Prompt API) ———
/** Checks whether Chrome can run the on-device model (when Finder opens, at most every 30 s; `fresh` asks now). */
export async function refreshAi(fresh = true) {
  let s = 'unavailable';
  if (setting('finderLocalAi') !== false && globalThis.LanguageModel) {
    try {
      s = await (await import('./ai.js')).aiStatus(lang(), { fresh });
    } catch {}
  }
  if (s !== local) {
    local = s;
    if (open) {
      placeholder();
      update();
    }
  }
  return s;
}

/** Answers `q` on this device in the conversation card (follow-ups continue the same chat). */
async function answerLocal(q, { define = false } = {}) {
  const ai = await import('./ai.js');
  if (!chat) {
    const thread = h('div', { class: 'fai-thread' });
    const card = h('div', { class: 'fr-sec finder-ai-card' },
      h('div', { class: 'fai-head' },
        h('span', { class: 'fai-badge', html: icon('sparkle', 16) }),
        h('span', { class: 'fai-title' }, t('finder.onDeviceAi')),
        h('span', { class: 'fai-private' }, t('finder.private')),
        h('button', { class: 'fai-close', title: t('common.close'), 'aria-label': t('common.close'), html: icon('close', 18), onClick: () => endChat() })),
      thread);
    chat = { el: card, thread, ctrl: null };
    ai.resetChat();
  }
  chat.ctrl?.abort();
  const ctrl = (chat.ctrl = new AbortController());
  const mine = chat;
  results = [];
  sel = 0;
  chips.hidden = true;
  askChip.hidden = true;
  list.replaceChildren(chat.el);
  input.value = '';
  placeholder();
  input.focus();

  const text = h('div', { class: 'fai-text', dir: 'auto' }, h('span', { class: 'fai-dots' }, h('i'), h('i'), h('i')));
  const prog = h('div', { class: 'fai-prog', hidden: true }, h('i'));
  const acts = h('div', { class: 'fai-acts' });
  const turn = h('div', { class: 'fai-turn' }, h('div', { class: 'fai-q', dir: 'auto' }, define ? t('finder.cmdDefine', { word: q }) : q), text, prog, acts);
  chat.thread.append(turn);
  turn.scrollIntoView({ block: 'nearest' });
  const live = () => chat === mine && !ctrl.signal.aborted;
  let answer = '';
  const handOff = () => askAi(define ? t('finder.defineAsk', { word: q }) : q);
  const chip = (ic, label, fn) => h('button', { class: 'fai-chip', onClick: fn }, h('span', { html: icon(ic, 16) }), label);
  const opts = {
    lang: lang(), signal: ctrl.signal,
    onChunk: (v) => {
      if (!live()) return;
      answer = v;
      text.replaceChildren(...mdLite(v));
      prog.hidden = true;
    },
    onProgress: (p) => {
      if (!live()) return;
      prog.hidden = false;
      prog.firstChild.style.width = Math.round(p * 100) + '%';
    },
  };
  try {
    if (define) await ai.promptOnce(ai.DEFINE, q, opts);
    else await ai.ask(q, opts);
    if (!live()) return;
    if (!answer) text.replaceChildren(h('p', { class: 'fai-muted' }, t('finder.aiEmpty')));
    acts.replaceChildren(chip('copy', t('finder.copy'), () => copy(answer)), chip('external', t('finder.continueIn', { ai: aiName() }), handOff));
  } catch (e) {
    if (!live()) return;
    console.warn('on-device AI', e);
    text.replaceChildren(h('p', { class: 'fai-muted' }, t('finder.aiUnavailable')));
    acts.replaceChildren(chip('external', t('finder.askAi', { ai: aiName() }), handOff));
  }
}

function endChat(refresh = true) {
  chat?.ctrl?.abort();
  chat = null;
  import('./ai.js').then((m) => m.resetChat()).catch(() => {});
  if (refresh) {
    placeholder();
    update();
  }
}

/** The model's plain text with "-" bullets and **bold** as DOM (text nodes only: nothing is parsed as HTML). */
function mdLite(text) {
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/).map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? h('b', null, p.slice(2, -2)) : p));
  const out = [];
  let ul = null;
  for (const raw of String(text).split('\n')) {
    const li = raw.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      if (!ul) out.push((ul = h('ul')));
      ul.append(h('li', null, ...inline(li[1])));
      continue;
    }
    ul = null;
    if (raw.trim()) out.push(h('p', null, ...inline(raw.replace(/^#+\s*/, ''))));
  }
  return out;
}

// ——— voice input (Chrome's on-device speech recognition only) ———
async function refreshMic() {
  if (setting('finderVoice') === false) return (micBtn.hidden = true);
  try {
    speech ||= await import('../interpreter/speech.js');
    if (!speech.hasOnDevice()) return (micBtn.hidden = true);
    // downloadable counts: the language pack installs on the first click, as in Interpreter
    micBtn.hidden = (await speech.micStatus(lang())) === 'unavailable';
  } catch {
    micBtn.hidden = true;
  }
}

async function toggleMic() {
  if (listening) return listening.stop();
  if (!speech) return;
  const stopUi = () => {
    listening = null;
    micBtn.classList.remove('on');
    el.classList.remove('listening');
    placeholder();
  };
  let final = '';
  micBtn.classList.add('on');
  el.classList.add('listening');
  input.value = '';
  try {
    listening = await speech.listen(lang(), {
      onInterim: (txt) => {
        input.value = [final, txt].filter(Boolean).join(' ');
        if (!chat) update();
      },
      onFinal: (txt) => {
        final = [final, txt].filter(Boolean).join(' ');
        input.value = final;
        if (!chat) update();
      },
      onEnd: () => {
        stopUi();
        // a spoken question is sent like a typed one followed by Enter in AI mode or a conversation
        if (final && (chat || aiMode)) (chat || localOn() ? answerLocal(final) : results[sel]?.run());
      },
      onError: (code) => {
        if (code === 'not-allowed' || code === 'service-not-allowed') toast(t('finder.micDenied'));
        else if (code === 'language-not-supported') toast(t('finder.micUnavailable'));
      },
    });
    placeholder();
  } catch {
    stopUi();
    toast(t('finder.micUnavailable'));
  }
}

// ——— ranking ———
const fold = (s) => String(s ?? '').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
const textOf = (x) => (x instanceof Node ? x.textContent : String(x ?? ''));
/** How well `hay` matches what was typed: 100 the same, ~80 starts with it, ~60 a word starts with it, ~45 contains it,
 *  ~20 its letters start words in order ("ytb" → YouTube), 0 otherwise (Liquid Tab's fuzzyScore). */
export function fuzzy(needle, hay) {
  needle = fold(needle);
  hay = fold(hay);
  if (!needle || !hay) return 0;
  if (hay === needle) return 100;
  if (hay.startsWith(needle)) return 80 - Math.min(20, hay.length - needle.length) * 0.5;
  const wi = hay.split(/[\s\-_.\/]+/).findIndex((w) => w.startsWith(needle));
  if (wi >= 0) return 60 - wi;
  const idx = hay.indexOf(needle);
  if (idx >= 0) return 45 - Math.min(15, idx);
  let i = 0;
  for (let k = 0; k < hay.length && i < needle.length; k++) if (hay[k] === needle[i] && (i || !k || /[\s\-_.\/]/.test(hay[k - 1]))) i++;
  return i === needle.length && needle.length > 1 ? 20 - Math.min(10, hay.length / 10) : 0;
}
/**
 * A score for a command row that didn't bring its own: how many typed words its title names (exact titles first). A
 * title that repeats the typed words in quotes ("Play “sudoku” in Music") is a catch-all and ranks under one that
 * names the thing ("Play Sudoku").
 */
export function commandScore(q, r) {
  if (typeof r.score === 'number') return r.score;
  if (r.answer) return 92;
  const title = fold(textOf(r.title)), fq = fold(q);
  const words = (s) => s.split(/[\s,.:;!?·“”"«»()]+/).filter(Boolean);
  const qw = words(fq), tw = words(title);
  if (!qw.length) return 50;
  const hit = qw.filter((w) => tw.some((x) => x === w || (w.length > 2 && x.startsWith(w)))).length / qw.length;
  const quoted = title.match(/[“"«]([^”"»]+)[”"»]/);
  const echo = quoted && fq.includes(quoted[1].trim());
  return Math.round(50 + 40 * hit + (tw.join(' ') === qw.join(' ') ? 8 : 0) - (echo ? 15 : 0));
}

// ——— instant answers ———
const fmtNum = (n) => new Intl.NumberFormat(locale(), { maximumFractionDigits: Math.abs(n) < 1 ? 6 : 4 }).format(n);
const ltr = (s) => '⁦' + s + '⁩';

function mathAnswer(q) {
  // "20% من 150" = "20% of 150"; "=" before or after is how people ask a calculator
  const expr = q.replace(/^=\s*/, '').replace(/\s*=\s*$/, '').replace(/%\s*من\s+/g, '% of ').trim();
  // 2026-10-26 is a date, not a subtraction
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(expr) || !C.looksLikeMath(expr)) return null;
  const v = C.calc(expr, { mod: true });
  if (typeof v !== 'number' || !isFinite(v)) return null;
  const value = C.clean(v);
  return { icon: 'calc', title: '= ' + fmtNum(value), sub: q.replace(/\s*=\s*$/, ''), answer: true, run: () => copy(value) };
}

function convertAnswer(q) {
  const c = C.parseConversion(q);
  if (!c || !isFinite(c.result)) return null;
  const out = C.clean(c.result);
  return { icon: 'sort', title: ltr(`${fmtNum(c.value)} ${C.unitSymbol(c.from)} = ${fmtNum(out)} ${C.unitSymbol(c.to)}`), sub: t('finder.conversion'), answer: true, run: () => copy(out) };
}

function timeAnswer(q) {
  const tq = N.timeQuery(q);
  const tz = tq && N.cityZone(tq.city, { exact: tq.exact });
  if (!tz) return null;
  const time = new Intl.DateTimeFormat(locale(), { timeZone: tz, hour: 'numeric', minute: '2-digit', weekday: 'short', hour12: use12h() }).format(new Date());
  return { icon: 'globe', title: time, sub: tz.replace(/_/g, ' '), answer: true, run: () => copy(time) };
}

const longDate = (d) => fmtDate(d, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const relDays = (n) => new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(n, 'day');
function hijri(d) {
  try {
    return new Intl.DateTimeFormat(lang() === 'ar' ? 'ar-SA-u-ca-islamic-umalqura-nu-latn' : 'en-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  } catch {
    return '';
  }
}
function dateAnswer(q) {
  const d = N.parseDateQuestion(q);
  if (!d) return null;
  const week = t('finder.week', { n: N.isoWeek(d.date) });
  const [title, sub] = {
    until: () => [relDays(d.days), longDate(d.date)],
    since: () => [relDays(d.days), longDate(d.date)],
    weekday: () => [fmtDate(d.date, { weekday: 'long' }), `${longDate(d.date)} · ${relDays(d.days)}`],
    offset: () => [fmtDate(d.date, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }), relDays(d.days)],
    today: () => [longDate(d.date), [week, hijri(d.date)].filter(Boolean).join(' · ')],
    week: () => [week, longDate(d.date)],
    hijri: () => [hijri(d.date) || longDate(d.date), longDate(d.date)],
  }[d.kind]();
  return { icon: 'calendar', title, sub, answer: true, run: () => copy(title) };
}

// ——— quick commands ———
function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return [hh && `${hh}h`, mm && `${mm}m`, ss && `${ss}s`].filter(Boolean).join(' ') || '0s';
}

function whenText(w) {
  const day = new Date(w.date + 'T00:00');
  const diff = Math.round((day - startOfDay()) / 864e5);
  const d = diff === 0 ? t('common.today') : diff === 1 ? t('common.tomorrow') : fmtDate(day, diff > 0 && diff < 7 ? { weekday: 'long' } : { weekday: 'short', month: 'short', day: 'numeric' });
  return w.time ? `${d}${lang() === 'ar' ? '، ' : ', '}${fmtTime(w.when)}` : d;
}
/** A date without a time is due at 9:00 that day, like Reminder's own quick add. */
const dueOf = (w) => (w.time ? w.when.getTime() : new Date(w.when).setHours(9, 0, 0, 0));

async function addReminder(title, w) {
  const due = w ? dueOf(w) : null;
  let r = null;
  try {
    const m = await import('../apps/reminder.js');
    if (typeof m.addReminder === 'function') r = m.addReminder({ title, due });
  } catch {}
  if (!r) {
    r = { id: uid(), title, notes: '', due, done: false, priority: false, created: Date.now() };
    store.update('reminders', (l) => [r, ...(l || [])]);
    if (due && due > Date.now()) scheduleAt('reminder:' + r.id, due);
  }
  toast(due ? t('finder.reminderAt', { when: whenText(w) }) : t('finder.reminderSaved'));
}

/** Adds an event the way Calendar's editor does (one hour, 10-minute alert through an `event:<id>` alarm). */
function addEvent(title, w) {
  const allDay = !w.time;
  const start = allDay ? new Date(w.date + 'T00:00').getTime() : w.when.getTime();
  const ev = { id: uid(), title, start, end: allDay ? start : start + 3600e3, allDay, color: '#3e7bff', notes: '', alert: '10' };
  store.update('events', (l) => [...(l || []), ev]);
  const at = (allDay ? start + 9 * 3600e3 : start) - 10 * 60e3;
  if (at > Date.now()) scheduleAt('event:' + ev.id, at);
  toast(t('finder.eventAdded'));
  return ev;
}

const noun = (s) => s.replace(/^ال(?=\S{3})/, '').trim();

/** Built-in commands for the folded query `f` (q keeps the user's own text). Each row says how sure it is (score). */
function builtins(q, f) {
  const out = [];
  const cmd = t('finder.command');
  const add = (score, ic, title, sub, run, extra) => out.push({ score, icon: ic, title, sub, run, ...extra });
  let m;
  // timer 5m · set a timer for 10 minutes · 5 min timer · مؤقت ١٠ دقائق
  if ((m = f.match(/^(?:set (?:a )?)?(?:timer|countdown)(?: for)?\s+(.+)$|^(?:مؤقت|عداد|اضبط مؤقت)(?:\s+(?:ل|لمده))?\s+(.+)$|^(.+?)\s+timer$/))) {
    const sec = N.parseDuration(m[1] || m[2] || m[3]);
    if (sec && sec < 100 * 3600) {
      const ms = sec * 1000;
      add(96, 'timer', t('finder.cmdTimer', { d: fmtDur(ms) }), cmd, () => {
        const id = uid();
        const endsAt = Date.now() + ms;
        store.update('timers', (l) => [...(l || []), { id, label: '', duration: ms, endsAt, remaining: ms, running: true }]);
        scheduleAt('timer:' + id, endsAt);
        toast(t('finder.timerStarted', { d: fmtDur(ms) }));
        closeFinder();
      });
    }
  }
  if ((m = f.match(/^(?:focus|pomodoro|تركيز)\s*(\d+)?\s*(?:m|min|mins|minutes?|دقيقه|دقائق|د)?$/))) {
    const min = parseInt(m[1] || setting('focusMinutes'), 10);
    if (min > 0 && min <= 600) add(96, 'dnd', t('finder.cmdFocus', { n: min }), cmd, () => { startFocus(min); closeFinder(); });
  }
  if ((m = q.match(/^(?:note|notes|ملاحظة|ملاحظه)\s*:\s*(.+)$/i))) {
    const text = m[1].trim();
    add(96, 'note', t('finder.cmdNote'), text, () => {
      const now = Date.now();
      const [first, ...rest] = text.split(/(?<=[.!?؟])\s+/);
      store.update('notes', (n) => [{ id: uid(), title: first.slice(0, 80), body: escapeHtml(rest.join(' ')), color: '', pinned: false, created: now, updated: now }, ...(n || [])]);
      toast(t('finder.noteSaved'));
      closeFinder();
    });
  }
  const rem = N.parseReminder(q);
  if (rem) {
    add(96, 'checkCircle', t('finder.cmdRemind'), rem.when ? `${rem.title} · ${whenText(rem.when)}` : rem.title, () => {
      addReminder(rem.title, rem.when);
      closeFinder();
    });
  }
  if (/^(?:dark mode|dark|turn on dark mode|الوضع الداكن|الوضع الليلي|داكن)$/.test(f)) add(96, 'moon', t('finder.cmdDark'), cmd, () => { setSetting('theme', 'dark'); closeFinder(); });
  if (/^(?:light mode|light|turn on light mode|الوضع الفاتح|الوضع النهاري|فاتح)$/.test(f)) add(96, 'sun', t('finder.cmdLight'), cmd, () => { setSetting('theme', 'light'); closeFinder(); });
  if (/^(?:lock|lock screen|قفل|قفل الشاشه)$/.test(f)) add(96, 'lock', t('finder.cmdLock'), cmd, () => { closeFinder(); import('./lock.js').then((x) => x.lockNow()); });
  if (/^(?:flashlight|torch|كشاف|الكشاف|مصباح|المصباح)$/.test(f)) add(94, 'flashlight', t('finder.cmdTorch'), cmd, () => { closeFinder(); torch(); });

  // wallpaper sunset · wallpaper random · خلفية غروب
  if ((m = f.match(/^(?:wallpaper|background|خلفيه|الخلفيه|غير الخلفيه)(?:\s+(?:to|الي|ل))?\s*(.*)$/))) {
    const want = noun(m[1]);
    if (!want) add(80, 'image', t('finder.cmdWallpapers'), t('finder.wallpaper'), () => { closeFinder(); openApp('settings', { params: { page: 'wallpaper' } }); });
    else if (/^(?:random|shuffle|any|surprise me|عشوائي|عشوائيه|اي)$/.test(want)) {
      const p = PRESETS[Math.floor(Math.random() * PRESETS.length)];
      add(92, 'image', t('finder.cmdWallpaper', { name: t('wall.' + p.id) }), t('finder.wallpaper'), () => setWallpaper(p.id));
    } else {
      const p = PRESETS.find((x) => x.id === want || noun(fold(t('wall.' + x.id))) === want) || PRESETS.find((x) => want.length > 2 && (x.id.startsWith(want) || fold(t('wall.' + x.id)).startsWith(want)));
      if (p) add(94, 'image', t('finder.cmdWallpaper', { name: t('wall.' + p.id) }), t('finder.wallpaper'), () => setWallpaper(p.id));
    }
  }
  // play rain · rain sounds · شغل صوت المطر
  if ((m = f.match(/^(?:play|start|شغل|تشغيل)\s+(.+)$|^(.+?)\s+(?:sounds?|noise)$/))) {
    const want = noun((m[1] || m[2]).replace(/^(?:the\s+)?/, '').replace(/\s+(?:sounds?|ambient)$/, '').replace(/^(?:صوت|اصوات)\s+/, ''));
    const name = (s) => fold(t('sound.' + s.id));
    const exact = want && SOUNDS.find((s) => s.id === want || name(s) === want || noun(name(s)) === want || name(s).split(' ').some((w) => noun(w) === want));
    const partial = !exact && want.length > 2 && SOUNDS.find((s) => s.id.startsWith(want) || name(s).includes(want));
    const s = exact || partial || (m[2] && SOUNDS.find((x) => x.id === noun(m[2])));
    if (s) add(exact ? 95 : 80, s.icon || 'sound', t('finder.cmdSound', { name: t('sound.' + s.id) }), t('finder.sounds'), () => { closeFinder(); playSound(s.id); });
  }
  if (/^(?:stop|pause)(?: the)? (?:sounds?|ambient sounds?|noise|ambient)$|^(?:اوقف|ايقاف)\s+(?:ال)?(?:صوت|اصوات)$/.test(f) && soundState().playing) {
    add(94, 'pause', t('finder.cmdSoundStop'), t('sound.' + soundState().id), () => { closeFinder(); pauseSound(); });
  }
  // open calendar · افتح الساعة
  if ((m = f.match(/^(?:open|launch|افتح|فتح|شغل تطبيق)\s+(.+)$/))) {
    const want = m[1].trim();
    const best = getApps().filter((a) => !a.hidden).map((a) => [a, Math.max(fuzzy(want, appName(a)), fuzzy(want, a.id), ...(a.keywords || []).map((k) => fuzzy(want, k) * 0.9))]).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 55) add(90, null, t('finder.cmdOpen', { app: appName(best[0]) }), t('finder.app'), () => { closeFinder(); openApp(best[0].id); }, { appEl: () => appIconEl(best[0]) });
  }
  // define serendipity · ما معنى … (only with the on-device model: no online dictionary)
  if (localOn() && (m = N.foldArabic(q).match(/^(?:define|definition of|meaning of|ما معنى|ما معني|معنى|معني|تعريف|عرف)\s+(.+)$|^what does (.+) mean\??$/i))) {
    const word = (m[1] || m[2] || '').replace(/[?؟]+$/, '').replace(/^(?:the word|word|كلمة|كلمه)\s+/i, '').trim();
    if (word && word.split(/\s+/).length <= 4) add(75, 'sparkle', t('finder.cmdDefine', { word }), t('finder.onDeviceAi'), () => answerLocal(word, { define: true }), { ai: true });
  }
  return out;
}

function setWallpaper(id) {
  setSetting('wallpaper', { type: 'preset', id });
  toast(t('finder.wallpaperSet'));
  closeFinder();
}

/** "lunch with Sara Friday 1pm" → Add to Calendar (and a reminder), when the sentence has a date or time. */
function eventRows(q, f) {
  if (/^(?:timer|focus|note|play|run|wallpaper|translate|ترجم|مؤقت|تركيز|شغل|افتح|time in|open|define)(?=\s|:|$)/i.test(f)) return [];
  const words = q.split(/\s+/).length;
  if (words < 2) return [];
  const w = N.parseWhen(q);
  if (!w || w.title.length < 2 || (words < 3 && !w.time)) return [];
  const title = w.title.charAt(0).toUpperCase() + w.title.slice(1);
  return [
    { score: 72, icon: 'calendar', title: t('finder.cmdEvent', { text: title }), sub: whenText(w), run: () => { addEvent(title, w); closeFinder(); } },
    { score: 64, icon: 'checkCircle', title: t('finder.cmdRemindText', { text: title }), sub: whenText(w), run: () => { addReminder(title, w); closeFinder(); } },
  ];
}

// ——— results ———
async function update() {
  const my = ++seq;
  const q = input.value.trim();
  sel = 0;
  askChip.hidden = !(q && localOn() && !aiMode && !chat);
  if (chat) return; // typing in a conversation is the follow-up question; Enter sends it
  if (!q) {
    chips.replaceChildren(...suggestionChips());
    chips.hidden = false;
    results = [];
    list.replaceChildren(...(aiMode ? [] : recentApps()));
    return;
  }
  chips.hidden = true;
  await libs();
  if (my !== seq) return;

  if (aiMode) {
    const rows = [];
    if (localOn()) rows.push({ icon: 'sparkle', title: q, sub: local === 'available' ? t('finder.answerLocal') : t('finder.answerLocalDl'), run: () => answerLocal(q), ai: true });
    rows.push({ icon: 'sparkle', title: q, sub: t('finder.askAi', { ai: aiName() }), run: (e) => askAi(q, e), ai: true });
    render([{ rows }]);
    return;
  }

  const f = N.foldCmd(q);
  const top = [];
  const url = toUrl(q);
  if (url) top.push({ fav: url, title: url.replace(/^https?:\/\//, ''), sub: t('finder.goTo'), run: (e) => { closeFinder(); openUrl(url, e); } });
  const answers = [mathAnswer, convertAnswer, timeAnswer, dateAnswer].map((fn) => { try { return fn(q); } catch (e) { console.warn('finder', e); return null; } }).filter(Boolean);
  const own = builtins(q, f);
  const theirs = runCommands(q, closeFinder);
  for (const r of theirs) r.score = commandScore(q, r);
  const cmds = [...own, ...theirs];
  if (!answers.length && !own.length) cmds.push(...eventRows(q, f));
  cmds.sort((a, b) => b.score + (b.prio || 0) - (a.score + (a.prio || 0)));
  top.push(...answers, ...cmds);

  // apps, Settings, sites, the apps' content, bookmarks, history: each section ranked by its best match
  const sections = [];
  const section = (title, rows, bias = 0, kind = '') => rows.length && sections.push({ title, rows, kind, score: Math.max(...rows.map((r) => r.score || 0)) + bias });
  const apps = getApps().filter((a) => !a.hidden)
    .map((a) => ({ a, score: Math.max(fuzzy(q, appName(a)), fuzzy(q, a.id) * 0.9, ...(a.keywords || []).map((k) => (fuzzy(q, k) >= 45 ? fuzzy(q, k) * 0.8 : 0))) }))
    .filter((x) => x.score >= 30).sort((x, y) => y.score - x.score).slice(0, 6)
    .map(({ a, score }) => ({ appEl: () => appIconEl(a), title: appName(a), sub: t('finder.app'), score, run: () => { closeFinder(); openApp(a.id); } }));
  section(t('finder.apps'), apps, 6, 'apps');

  const seen = new Set();
  const sites = allItems()
    .filter((it) => it.type === 'site' && !seen.has(it.url) && seen.add(it.url))
    .map((it) => ({ it, score: Math.max(fuzzy(q, itemLabel(it)), fuzzy(q, hostname(it.url)) * 0.9, it.url.toLowerCase().includes(q.toLowerCase()) ? 35 : 0) }))
    .filter((x) => x.score >= 30).sort((x, y) => y.score - x.score).slice(0, 6)
    .map(({ it, score }) => ({ itemEl: () => itemIconEl(it), title: itemLabel(it), sub: hostname(it.url), score, run: (e) => { closeFinder(); openItem(it, null, e); } }));
  section(t('finder.sites'), sites, 3, 'sites');

  // per-app content (Settings rows, notes, reminders, events…), in the app's own order
  try {
    const sm = await import('../apps/settings.js');
    await Promise.race([sm.indexSettings?.(), new Promise((r) => setTimeout(r, 600))]);
  } catch {}
  if (my !== seq) return;
  for (const app of getApps()) {
    if (!app.search) continue;
    try {
      const r = (await app.search(q)) || [];
      if (my !== seq) return;
      // Settings rows are ranked by how well their label matches (an exact row before a section that only mentions it);
      // other apps keep their own order (recent first, best match first…)
      const rows = r.map((x) => ({ appEl: () => appIconEl(app), title: x.title, sub: x.sub, score: Math.max(fuzzy(q, x.title), 30), run: (e) => { closeFinder(); x.onOpen?.(e); } }));
      if (app.id === 'settings') rows.sort((a, b) => b.score - a.score);
      section(appName(app), rows.slice(0, app.id === 'settings' ? 5 : 4), app.id === 'settings' ? 2 : 0, app.id);
    } catch (e) {
      console.warn('search', app.id, e);
    }
  }

  // bookmarks + history (optional permissions)
  if (isExt && setting('finderBookmarks') && chrome.bookmarks) {
    try {
      const b = (await chrome.bookmarks.search(q)).filter((x) => x.url).slice(0, 5);
      if (my !== seq) return;
      section(t('finder.bookmarks'), b.map((x) => ({ fav: x.url, title: x.title || x.url, sub: hostname(x.url), score: Math.max(fuzzy(q, x.title), 30), run: (e) => { closeFinder(); openUrl(x.url, e); } })), -4);
    } catch {}
  }
  if (isExt && setting('finderHistory') && chrome.history) {
    try {
      const hs = (await chrome.history.search({ text: q, maxResults: 6, startTime: Date.now() - 90 * 864e5 })).filter((x) => x.url);
      if (my !== seq) return;
      section(t('finder.history'), hs.map((x) => ({ fav: x.url, title: x.title || x.url, sub: hostname(x.url), score: Math.max(fuzzy(q, x.title), 30), run: (e) => { closeFinder(); openUrl(x.url, e); } })), -6);
    } catch {}
  }
  sections.sort((a, b) => b.score - a.score);

  const engName = ENGINES[setting('searchEngine')]?.url ? ENGINES[setting('searchEngine')].name : t('finder.theWeb');
  const web = [
    { icon: 'search', title: q, sub: t('finder.searchWith', { engine: engName }), run: (e) => webSearch(q, e) },
    { icon: 'sparkle', title: q, sub: t('finder.askAi', { ai: aiName() }) + (localOn() ? '' : ' · Tab'), run: (e) => askAi(q, e), ai: true },
  ];
  if (my !== seq) return;
  render([{ rows: top }, ...sections, { rows: web, kind: 'web' }]);
}

function render(sections) {
  results = [];
  const cards = [];
  for (const sec of sections) {
    if (!sec.rows.length) continue;
    const rows = sec.rows.map((r) => {
      const i = results.length;
      results.push(r);
      const ico = r.appEl ? r.appEl() : r.itemEl ? r.itemEl() : r.fav ? h('span', { class: 'fr-fav' }, h('img', { src: faviconUrl(r.fav, 32), alt: '' })) : h('span', { class: ['fr-ico', r.ai && 'ai', r.answer && 'answer'], html: icon(r.icon || 'search', 20) });
      return h('button', { class: ['fr', r.answer && 'answer'], role: 'option', onClick: (e) => r.run(e), onPointermove: () => { if (sel !== i) { sel = i; paintSel(); } } },
        h('span', { class: 'fr-icon' }, ico),
        h('span', { class: 'fr-text' }, h('span', { class: 'fr-title', dir: 'auto' }, r.title), r.sub ? h('span', { class: 'fr-sub', dir: 'auto' }, r.sub) : null));
    });
    cards.push(h('div', { class: ['fr-sec', sec.kind && 'fr-sec-' + sec.kind] }, sec.title ? h('div', { class: 'fr-head' }, sec.title) : null, rows));
  }
  list.replaceChildren(...cards);
  paintSel();
}

// Example chips change with the time of day, like One UI's Finder suggestions
const CHIP_SETS = {
  morning: ['focus', 'remind', 'event', 'time', 'translate', 'percent', 'until'],
  afternoon: ['timer', 'note', 'math', 'convert', 'translate', 'weekday', 'rain'],
  evening: ['dark', 'rain', 'wallpaper', 'timer20', 'translate', 'timeNY', 'until'],
  night: ['ocean', 'dark', 'timer30', 'remindTomorrow', 'translate', 'wallNight', 'lock'],
};
const CHIP_ICONS = { focus: 'dnd', remind: 'checkCircle', remindTomorrow: 'checkCircle', event: 'calendar', time: 'globe', timeNY: 'globe', translate: 'text', percent: 'calc', math: 'calc', until: 'calendar', weekday: 'calendar', timer: 'timer', timer20: 'timer', timer30: 'timer', note: 'note', convert: 'sort', rain: 'rain', ocean: 'waves', dark: 'moon', wallpaper: 'image', wallNight: 'image', lock: 'lock' };
/** 'morning' (5–12), 'afternoon' (12–17), 'evening' (17–22) or 'night'. */
export const daypart = (hour = new Date().getHours()) => (hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'night');
/** The example queries Finder suggests at `hour` (in the UI language). */
export const exampleChips = (hour) => CHIP_SETS[daypart(hour)].map((k) => t('finder.ex.' + k));
const ASK_CHIPS = ['trip', 'explain', 'email', 'dinner'];

function suggestionChips() {
  const chip = (ic, text) => h('button', { class: 'finder-chip', onClick: () => { input.value = text; input.focus(); update(); } }, h('span', { class: 'finder-chip-ico', html: icon(ic, 15) }), h('bdi', null, text));
  if (aiMode) return ASK_CHIPS.map((k) => chip('sparkle', t('finder.askEx.' + k)));
  return CHIP_SETS[daypart()].map((k) => chip(CHIP_ICONS[k] || 'search', t('finder.ex.' + k)));
}

function recentApps() {
  const usage = store.get('usage') || {};
  const apps = getApps().filter((a) => !a.hidden);
  const ranked = [...apps].sort((a, b) => (usage['app:' + b.id] || 0) - (usage['app:' + a.id] || 0)).slice(0, 8);
  return [h('div', { class: 'fr-sec' },
    h('div', { class: 'fr-head' }, t('finder.suggested')),
    h('div', { class: 'finder-apps' },
      ranked.map((a) => h('button', { class: 'finder-app', onClick: () => { closeFinder(); openApp(a.id); } }, appIconEl(a), h('span', null, appName(a))))))];
}

addStrings({
  en: {
    'finder.placeholder': 'Search apps, settings, notes, or the web',
    'finder.askPlaceholder': 'Ask {ai} anything',
    'finder.askAi': 'Ask {ai}',
    'finder.ask': 'Ask',
    'finder.askLocalTip': 'Answer on this device (Tab)',
    'finder.onDeviceAi': 'On-device AI',
    'finder.private': 'Private · runs on this device',
    'finder.answerLocal': 'Answer on this device · private',
    'finder.answerLocalDl': 'Answer on this device · downloads the model first',
    'finder.followUp': 'Ask a follow-up…',
    'finder.copy': 'Copy',
    'finder.continueIn': 'Continue in {ai}',
    'finder.aiUnavailable': 'On-device AI isn’t available right now.',
    'finder.aiEmpty': 'No answer came back. Try asking another way.',
    'finder.voice': 'Voice input',
    'finder.listening': 'Listening…',
    'finder.micDenied': 'Allow microphone access to use voice input',
    'finder.micUnavailable': 'Voice input isn’t available on this device',
    'finder.engineDefault': 'Browser default',
    'finder.theWeb': 'the web',
    'finder.searchWith': 'Search with {engine}',
    'finder.goTo': 'Go to website',
    'finder.copied': 'Copied',
    'finder.conversion': 'Conversion',
    'finder.week': 'Week {n}',
    'finder.app': 'App',
    'finder.apps': 'Apps',
    'finder.sites': 'Websites',
    'finder.bookmarks': 'Bookmarks',
    'finder.history': 'History',
    'finder.suggested': 'Suggested apps',
    'finder.command': 'Quick command',
    'finder.cmdTimer': 'Start a {d} timer',
    'finder.timerStarted': 'Timer started · {d}',
    'finder.cmdFocus': 'Start Focus for {n} minutes',
    'finder.cmdNote': 'Save as a note',
    'finder.noteSaved': 'Note saved',
    'finder.cmdRemind': 'Create a reminder',
    'finder.cmdRemindText': 'Remind me: “{text}”',
    'finder.reminderSaved': 'Reminder saved',
    'finder.reminderAt': 'Reminder set for {when}',
    'finder.cmdEvent': 'Add to Calendar: “{text}”',
    'finder.eventAdded': 'Event added to Calendar',
    'finder.cmdDark': 'Turn on Dark mode',
    'finder.cmdLight': 'Turn on Light mode',
    'finder.cmdLock': 'Lock screen',
    'finder.cmdTorch': 'Turn on the flashlight',
    'finder.cmdWallpaper': 'Set wallpaper: {name}',
    'finder.cmdWallpapers': 'Change wallpaper',
    'finder.wallpaper': 'Wallpaper and style',
    'finder.wallpaperSet': 'Wallpaper set',
    'finder.cmdSound': 'Play {name}',
    'finder.cmdSoundStop': 'Stop the ambient sound',
    'finder.sounds': 'Ambient sounds',
    'finder.cmdOpen': 'Open {app}',
    'finder.cmdDefine': 'Define “{word}”',
    'finder.defineAsk': 'Define "{word}"',
    'finder.ex.timer': 'timer 5m',
    'finder.ex.timer20': 'timer 20m',
    'finder.ex.timer30': 'timer 30m',
    'finder.ex.focus': 'focus 25',
    'finder.ex.note': 'note: buy milk',
    'finder.ex.remind': 'remind me to call mom at 6pm',
    'finder.ex.remindTomorrow': 'remind me to call the dentist tomorrow at 9am',
    'finder.ex.event': 'lunch with Sara Friday 1pm',
    'finder.ex.time': 'time in Tokyo',
    'finder.ex.timeNY': 'time in New York',
    'finder.ex.translate': 'translate hello to spanish',
    'finder.ex.percent': '20% of 150',
    'finder.ex.math': '128*42',
    'finder.ex.convert': '10 km to mi',
    'finder.ex.until': 'days until Dec 25',
    'finder.ex.weekday': 'what day is Dec 25',
    'finder.ex.rain': 'play rain',
    'finder.ex.ocean': 'play ocean waves',
    'finder.ex.dark': 'dark mode',
    'finder.ex.wallpaper': 'wallpaper sunset',
    'finder.ex.wallNight': 'wallpaper midnight',
    'finder.ex.lock': 'lock',
    'finder.ex.open': 'open calendar',
    'finder.ex.define': 'define serendipity',
    'finder.askEx.trip': 'Plan a 3-day trip to Istanbul',
    'finder.askEx.explain': 'Explain quantum computing simply',
    'finder.askEx.email': 'Write a polite follow-up email',
    'finder.askEx.dinner': 'Ideas for a healthy dinner',
    // Settings › Search and Finder
    'finder.set.localAi': 'Answers on this device',
    'finder.set.localAiSub': 'Ask (Tab) answers with Chrome’s built-in AI, offline and private',
    'finder.set.localAiNo': 'Not available in this Chrome. Ask hands your question to {ai}.',
    'finder.set.localAiDl': 'Chrome downloads the model the first time you ask',
    'finder.set.voice': 'Voice input',
    'finder.set.voiceSub': 'Mic button in Finder, using speech recognition on this device only',
    'finder.set.voiceNo': 'Speech recognition on this device isn’t available in this Chrome',
    'finder.set.cmd.remind': 'Reminder with a date and time',
    'finder.set.cmd.event': 'Event in Calendar',
    'finder.set.cmd.dates': 'Days until a date, the day of a date',
    'finder.set.cmd.sounds': 'Ambient sound or wallpaper',
    'finder.set.cmd.translate': 'Translate on this device',
    'finder.set.cmd.define': 'Word definition (on-device AI)',
    'finder.set.cmd.open': 'Open any app',
    'finder.set.cmd.apps': 'Commands from your apps',
    'finder.set.cmd.appsEx': 'water · coffee 3.5$ · play sudoku · call Sara',
  },
  ar: {
    'finder.placeholder': 'ابحث في التطبيقات والإعدادات والملاحظات أو الويب',
    'finder.askPlaceholder': 'اسأل {ai} أي شيء',
    'finder.askAi': 'اسأل {ai}',
    'finder.ask': 'اسأل',
    'finder.askLocalTip': 'الإجابة على هذا الجهاز (Tab)',
    'finder.onDeviceAi': 'الذكاء الاصطناعي على الجهاز',
    'finder.private': 'خاص · يعمل على هذا الجهاز',
    'finder.answerLocal': 'الإجابة على هذا الجهاز · بخصوصية',
    'finder.answerLocalDl': 'الإجابة على هذا الجهاز · يتم تنزيل النموذج أولًا',
    'finder.followUp': 'اطرح سؤال متابعة…',
    'finder.copy': 'نسخ',
    'finder.continueIn': 'المتابعة في {ai}',
    'finder.aiUnavailable': 'الذكاء الاصطناعي على الجهاز غير متوفر حاليًا.',
    'finder.aiEmpty': 'لم تصل إجابة. جرّب أن تسأل بطريقة أخرى.',
    'finder.voice': 'الإدخال الصوتي',
    'finder.listening': 'جارٍ الاستماع…',
    'finder.micDenied': 'اسمح بالوصول إلى الميكروفون لاستخدام الإدخال الصوتي',
    'finder.micUnavailable': 'الإدخال الصوتي غير متوفر على هذا الجهاز',
    'finder.engineDefault': 'افتراضي المتصفح',
    'finder.theWeb': 'الويب',
    'finder.searchWith': 'البحث باستخدام {engine}',
    'finder.goTo': 'الانتقال إلى الموقع',
    'finder.copied': 'تم النسخ',
    'finder.conversion': 'تحويل',
    'finder.week': 'الأسبوع {n}',
    'finder.app': 'تطبيق',
    'finder.apps': 'التطبيقات',
    'finder.sites': 'المواقع',
    'finder.bookmarks': 'الإشارات المرجعية',
    'finder.history': 'السجل',
    'finder.suggested': 'تطبيقات مقترحة',
    'finder.command': 'أمر سريع',
    'finder.cmdTimer': 'بدء مؤقت لمدة {d}',
    'finder.timerStarted': 'بدأ المؤقت · {d}',
    'finder.cmdFocus': 'بدء التركيز لمدة {n} دقيقة',
    'finder.cmdNote': 'حفظ كملاحظة',
    'finder.noteSaved': 'تم حفظ الملاحظة',
    'finder.cmdRemind': 'إنشاء تذكير',
    'finder.cmdRemindText': 'ذكّرني: «{text}»',
    'finder.reminderSaved': 'تم حفظ التذكير',
    'finder.reminderAt': 'تم ضبط التذكير على {when}',
    'finder.cmdEvent': 'إضافة إلى التقويم: «{text}»',
    'finder.eventAdded': 'تمت إضافة الحدث إلى التقويم',
    'finder.cmdDark': 'تشغيل الوضع الداكن',
    'finder.cmdLight': 'تشغيل الوضع الفاتح',
    'finder.cmdLock': 'قفل الشاشة',
    'finder.cmdTorch': 'تشغيل الكشاف',
    'finder.cmdWallpaper': 'تعيين الخلفية: {name}',
    'finder.cmdWallpapers': 'تغيير الخلفية',
    'finder.wallpaper': 'الخلفية والنمط',
    'finder.wallpaperSet': 'تم تعيين الخلفية',
    'finder.cmdSound': 'تشغيل {name}',
    'finder.cmdSoundStop': 'إيقاف الصوت المحيطي',
    'finder.sounds': 'الأصوات المحيطية',
    'finder.cmdOpen': 'فتح {app}',
    'finder.cmdDefine': 'تعريف «{word}»',
    'finder.defineAsk': 'ما معنى "{word}"',
    'finder.ex.timer': 'مؤقت 5 دقائق',
    'finder.ex.timer20': 'مؤقت 20 دقيقة',
    'finder.ex.timer30': 'مؤقت 30 دقيقة',
    'finder.ex.focus': 'تركيز 25',
    'finder.ex.note': 'ملاحظة: شراء الحليب',
    'finder.ex.remind': 'ذكرني بالاتصال بأمي الساعة 6 مساءً',
    'finder.ex.remindTomorrow': 'ذكرني بموعد الطبيب غدًا الساعة 9 صباحًا',
    'finder.ex.event': 'غداء مع سارة الجمعة الساعة 1 ظهرًا',
    'finder.ex.time': 'الوقت في طوكيو',
    'finder.ex.timeNY': 'الوقت في نيويورك',
    'finder.ex.translate': 'ترجم مرحبا إلى الإسبانية',
    'finder.ex.percent': '20% من 150',
    'finder.ex.math': '128*42',
    'finder.ex.convert': '10 كم إلى ميل',
    'finder.ex.until': 'كم يوم حتى 25 ديسمبر',
    'finder.ex.weekday': 'أي يوم 25 ديسمبر',
    'finder.ex.rain': 'شغل صوت المطر',
    'finder.ex.ocean': 'شغل أمواج المحيط',
    'finder.ex.dark': 'الوضع الداكن',
    'finder.ex.wallpaper': 'خلفية غروب',
    'finder.ex.wallNight': 'خلفية منتصف الليل',
    'finder.ex.lock': 'قفل',
    'finder.ex.open': 'افتح التقويم',
    'finder.ex.define': 'ما معنى كلمة شغف',
    'finder.askEx.trip': 'خطط لرحلة لمدة 3 أيام إلى إسطنبول',
    'finder.askEx.explain': 'اشرح الحوسبة الكمومية ببساطة',
    'finder.askEx.email': 'اكتب رسالة متابعة مهذبة بالبريد الإلكتروني',
    'finder.askEx.dinner': 'أفكار لعشاء صحي',
    'finder.set.localAi': 'الإجابات على هذا الجهاز',
    'finder.set.localAiSub': 'يجيب «اسأل» (Tab) باستخدام الذكاء الاصطناعي المدمج في Chrome، دون اتصال وبخصوصية',
    'finder.set.localAiNo': 'غير متوفر في إصدار Chrome هذا. يرسل «اسأل» سؤالك إلى {ai}.',
    'finder.set.localAiDl': 'ينزّل Chrome النموذج في أول مرة تسأل فيها',
    'finder.set.voice': 'الإدخال الصوتي',
    'finder.set.voiceSub': 'زر الميكروفون في Finder، باستخدام التعرّف على الكلام على هذا الجهاز فقط',
    'finder.set.voiceNo': 'التعرّف على الكلام على هذا الجهاز غير متوفر في إصدار Chrome هذا',
    'finder.set.cmd.remind': 'تذكير بتاريخ ووقت',
    'finder.set.cmd.event': 'حدث في التقويم',
    'finder.set.cmd.dates': 'الأيام المتبقية حتى تاريخ، ويوم التاريخ',
    'finder.set.cmd.sounds': 'صوت محيطي أو خلفية',
    'finder.set.cmd.translate': 'الترجمة على هذا الجهاز',
    'finder.set.cmd.define': 'تعريف كلمة (الذكاء الاصطناعي على الجهاز)',
    'finder.set.cmd.open': 'فتح أي تطبيق',
    'finder.set.cmd.apps': 'أوامر من تطبيقاتك',
    'finder.set.cmd.appsEx': 'ماء · قهوة 3.5$ · العب سودوكو · اتصل بسارة',
  },
});
