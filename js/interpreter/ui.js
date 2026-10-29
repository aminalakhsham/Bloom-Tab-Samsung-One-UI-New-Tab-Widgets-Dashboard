// Interpreter UI (Samsung Interpreter / Galaxy AI translation on One UI): floating tabs Text, Conversation, Listening
// and Favourites, with Language packs and Settings pages from ⋮. Text translates as you type between two language
// pills with a swap button, keeps History and Favourites and reads results aloud with on-device voices. Conversation
// splits the window in two, the top half turned around for the person across the table, each half with its own
// keyboard (and mic where Chrome recognizes speech on the device). Listening mode captions a speaker in your language.
// Everything runs on this device with Chrome's built-in models (engine.js); where Chrome has none, Samsung-style
// "not available" states explain why.
import { h, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { addStrings, t, lang } from '../core/i18n.js';
import { store } from '../core/store.js';
import { toast, menu, confirm, iconBtn, list, row, switchRow, seg, subheader } from '../core/ui.js';
import * as M from './model.js';
import * as E from './engine.js';
import * as S from './speech.js';

const D = () => M.norm(store.get(M.KEY), lang());
function save(fn) {
  let r;
  store.update(M.KEY, (v) => {
    const d = M.norm(v, lang());
    r = fn(d);
    return d;
  });
  return r;
}
const P = () => M.normPrefs(store.get(M.PREFS));
const setPref = (k, v) => store.update(M.PREFS, (p) => ({ ...M.normPrefs(p), [k]: v }));

const TABS = [
  { id: 'text', icon: 'interpTranslate' },
  { id: 'convo', icon: 'interpChat' },
  { id: 'listen', icon: 'interpEar' },
  { id: 'favs', icon: 'star' },
];

// ——— small helpers ———
const dots = () => h('span', { class: 'ip-dots', role: 'status', 'aria-label': t('interpreter.translating') }, h('i'), h('i'), h('i'));
/** Someone's text: `lang` gives it the right glyphs and font, dir=auto takes the direction from the text itself. */
const textEl = (tag, cls, text, code) => h(tag, { class: cls, dir: 'auto', lang: code ? M.htmlLang(code) : null }, text);
function setIcon(btn, name, size = 20) {
  // only when it changes: replacing the glyph under the pointer between mousedown and mouseup drops the click
  if (btn.dataset.icon === name) return;
  btn.dataset.icon = name;
  btn.innerHTML = icon(name, size);
}
const copy = (text) => text && navigator.clipboard?.writeText(text).then(() => toast(t('interpreter.copied')), () => {});
function pill() {
  return h('button', { class: 'ip-pill', type: 'button' }, h('span', { class: 'ip-pill-name' }), h('span', { class: 'ip-pill-chev', html: icon('down', 16) }));
}
function setPill(b, text) {
  b.firstChild.textContent = text;
  b.title = text;
}
function swapButton(onSwap) {
  const b = h('button', {
    class: 'ip-swap', type: 'button', title: t('interpreter.swap'), 'aria-label': t('interpreter.swap'), html: icon('interpSwap', 22),
    onClick: () => {
      b.classList.remove('spin');
      void b.offsetWidth;
      b.classList.add('spin');
      onSwap();
    },
  });
  return b;
}
const ring = (p) => h('span', { class: 'ip-ring', role: 'progressbar', 'aria-label': t('interpreter.downloading'), 'aria-valuenow': Math.round((p || 0) * 100), style: { '--p': String(Math.round((p || 0) * 100)) } });
const progressText = (p) => (p == null ? t('interpreter.downloading') : t('interpreter.downloadingN', { n: Math.round(p * 100) }));

/** Samsung's full-card "not available" state (no error text, a reason and what to do instead). */
function naState(kind, action) {
  const listen = kind === 'listen';
  return h('div', { class: 'ip-na', dataset: { na: kind } },
    h('span', { class: 'ip-na-ico', html: icon(listen ? 'interpEar' : 'interpTranslate', 34) }),
    h('div', { class: 'ip-na-title' }, t(listen ? 'interpreter.listenNA' : 'interpreter.naTitle')),
    h('div', { class: 'ip-na-body' }, t(listen ? 'interpreter.listenNABody' : 'interpreter.naBody')),
    action ? h('button', { class: 'ou-btn tonal', onClick: action.run }, action.label) : null);
}

function toggleFav(e) {
  const on = save((d) => M.toggleFav(d, e));
  toast(t(on ? 'interpreter.favAdded' : 'interpreter.favRemoved'));
  return on;
}
function deleteEntry(kind, e) {
  const key = kind === 'fav' ? 'favs' : 'history';
  let idx = 0;
  save((d) => {
    idx = Math.max(0, d[key].findIndex((x) => x.id === e.id));
    d[key] = d[key].filter((x) => x.id !== e.id);
  });
  toast(t('interpreter.deleted'), { action: t('common.undo'), onAction: () => save((d) => void d[key].splice(idx, 0, e)) });
}
async function clearHistory() {
  if (!D().history.length) return;
  if (await confirm(t('interpreter.clearHistoryQ'), t('interpreter.clearHistoryMsg'), { okLabel: t('interpreter.clear'), danger: true })) save((d) => void (d.history = []));
}

// Speech output: one utterance at a time in the whole app; `speakingKey` says which button shows Stop.
let speakingKey = null;
const speakSubs = new Set();
const speakChanged = () => speakSubs.forEach((f) => f());
function speak(key, text, code) {
  if (speakingKey === key) return E.stopSpeaking();
  E.stopSpeaking();
  speakingKey = key;
  speakChanged();
  E.speak(text, code, {
    rate: P().rate,
    onEnd: () => {
      if (speakingKey !== key) return;
      speakingKey = null;
      speakChanged();
    },
  });
}

function entryMenu(at, e, kind) {
  const fav = !!M.findFav(D(), e);
  menu(at, [
    { label: t('interpreter.copy'), icon: 'copy', onClick: () => copy(e.out) },
    E.canSpeak(e.to) ? { label: t('interpreter.speak'), icon: 'volume', onClick: () => speak('row:' + e.id, e.out, e.to) } : null,
    { label: t(fav ? 'interpreter.unfav' : 'interpreter.fav'), icon: fav ? 'star' : 'starFill', onClick: () => toggleFav(e) },
    '-',
    { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteEntry(kind, e) },
  ]);
}

const moreBtn = (items) => iconBtn('more', (e) => menu(e.currentTarget, items(), { align: 'end' }), t('common.more'));
const commonItems = (ctx) => [
  { label: t('interpreter.packs'), icon: 'interpCloud', onClick: () => languagesPage(ctx) },
  { label: t('common.settings'), icon: 'settings', onClick: () => settingsPage(ctx) },
];

// ——— app ———
export function render(ctx) {
  let cleanup = null;
  const show = (id, params = {}) => {
    try {
      cleanup?.();
    } catch (e) {
      console.error(e);
    }
    cleanup = null;
    if (P().tab !== id) setPref('tab', id);
    const tabs = h('nav', { class: 'ou-tabs ip-tabs', role: 'tablist' }, TABS.map((tb) =>
      h('button', { class: ['ou-tab', tb.id === id && 'active'], role: 'tab', 'aria-selected': String(tb.id === id), dataset: { tab: tb.id }, onClick: () => tb.id !== id && show(tb.id) },
        h('span', { html: icon(tb.icon, 20) }), h('span', null, t('interpreter.tab.' + tb.id)))));
    cleanup = VIEWS[id](ctx, tabs, params, show);
  };
  const tabFor = (p) => (M.TABS.includes(p?.tab) ? p.tab : p?.text || p?.fav || p?.hist ? 'text' : null);
  ctx.setParams = (p = {}) => {
    if (tabFor(p)) show(tabFor(p), p);
    if (p.page === 'languages') languagesPage(ctx);
  };
  const p = ctx.params || {};
  show(tabFor(p) || P().tab, p);
  if (p.page === 'languages') languagesPage(ctx);
  return () => {
    try {
      cleanup?.();
    } catch (e) {
      console.error(e);
    }
    E.stopSpeaking();
    E.release();
  };
}

// ——— Text ———
function textView(ctx, tabs, params, show) {
  const page = ctx.page({ title: t('app.interpreter'), hero: false, className: 'ip-page ip-text-page', actions: [moreBtn(() => [
    ...commonItems(ctx).slice(0, 1),
    { label: t('interpreter.clearHistory'), icon: 'trash', disabled: !D().history.length, onClick: clearHistory },
    ...commonItems(ctx).slice(1),
  ])] });
  page.el.appendChild(tabs);
  page.body.classList.add('ip-body');
  const supported = E.supported();
  const offs = [];

  const fromBtn = pill(), toBtn = pill();
  fromBtn.dataset.pick = 'from';
  toBtn.dataset.pick = 'to';
  const swap = swapButton(doSwap);
  fromBtn.addEventListener('click', () => pickLang(ctx, { title: t('interpreter.from'), current: D().from, auto: true, onPick: (c) => setLang('from', c) }));
  toBtn.addEventListener('click', () => pickLang(ctx, { title: t('interpreter.to'), current: D().to, onPick: (c) => setLang('to', c) }));

  const input = h('textarea', { class: 'ip-input', rows: 3, dir: 'auto', spellcheck: 'true', maxlength: 5000, placeholder: t('interpreter.enterText'), 'aria-label': t('interpreter.enterText') });
  const inLbl = h('span', { class: 'ip-lbl' });
  const detBadge = h('span', { class: 'ip-det', hidden: true }, t('interpreter.detected'));
  const clearBtn = h('button', { class: 'ip-x', type: 'button', hidden: true, title: t('interpreter.clear'), 'aria-label': t('interpreter.clear'), html: icon('close', 18), onClick: clearInput });
  const micBtn = h('button', { class: 'ou-icon-btn ip-mic', type: 'button', hidden: true, dataset: { act: 'dictate' }, title: t('interpreter.mic'), 'aria-label': t('interpreter.mic'), html: icon('mic', 22), onClick: dictate });
  const srcSpeak = h('button', { class: 'ou-icon-btn', type: 'button', hidden: true, dataset: { act: 'speak-src' }, title: t('interpreter.speak'), 'aria-label': t('interpreter.speak'), html: icon('volume', 22), onClick: () => speak('src', input.value, cur.from || srcCode()) });
  const count = h('span', { class: 'ip-count' });
  const goBtn = h('button', { class: 'ou-btn primary ip-go', type: 'button', hidden: true, onClick: () => run({ gesture: true }).then(commit) }, t('interpreter.translate'));
  const inCard = h('div', { class: 'ip-card ip-in' },
    h('div', { class: 'ip-card-head' }, inLbl, detBadge, h('span', { class: 'ip-sp' }), clearBtn),
    input,
    h('div', { class: 'ip-card-foot' }, micBtn, srcSpeak, h('span', { class: 'ip-sp' }), count, goBtn));

  const outLbl = h('span', { class: 'ip-lbl' });
  const output = h('div', { class: 'ip-output', dir: 'auto', 'aria-live': 'polite' });
  const note = h('div', { class: 'ip-note', hidden: true });
  const act = (name, ic, label, fn) => h('button', { class: 'ou-icon-btn ip-act', type: 'button', dataset: { act: name, icon: ic }, title: label, 'aria-label': label, html: icon(ic, 20), onClick: fn });
  const copyBtn = act('copy', 'copy', t('interpreter.copy'), () => copy(cur.out));
  const speakBtn = act('speak', 'volume', t('interpreter.speak'), () => cur.out && speak('out', cur.out, cur.to));
  const favBtn = act('fav', 'star', t('interpreter.fav'), () => {
    if (!cur.out) return;
    toggleFav(cur);
    drawOut();
  });
  const acts = h('div', { class: 'ip-acts' }, copyBtn, speakBtn, h('span', { class: 'ip-sp' }), favBtn);
  const outCard = h('div', { class: 'ip-card ip-out' }, h('div', { class: 'ip-card-head' }, outLbl), output, note, acts);
  const hist = h('div', { class: 'ip-hist' });
  page.body.append(h('div', { class: 'ip-text' },
    h('div', { class: 'ip-langbar' }, fromBtn, swap, toBtn),
    supported ? h('div', { class: 'ip-cards' }, inCard, outCard) : naState('text'),
    hist));

  // the translation on screen: what was translated, from and to which language (Auto detect can change both)
  let cur = { src: '', out: '', from: null, to: null };
  let detected = null, seq = 0, sessionId = null, pending = null, opened = null;
  const srcCode = () => (D().from === 'auto' ? detected : D().from);

  function drawLangs() {
    const d = D(), from = srcCode();
    setPill(fromBtn, d.from === 'auto' ? t('interpreter.auto') : E.langName(d.from));
    fromBtn.classList.toggle('auto', d.from === 'auto');
    setPill(toBtn, E.langName(d.to));
    inLbl.textContent = from ? E.langName(from) : t('interpreter.auto');
    detBadge.hidden = !(d.from === 'auto' && detected);
    outLbl.textContent = E.langName(cur.to || d.to);
    if (from) input.lang = M.htmlLang(from);
    else input.removeAttribute('lang');
    swap.disabled = d.from === 'auto' && !detected;
    drawMic();
  }
  function drawOut() {
    const has = !!cur.out && !!input.value.trim(), to = cur.to || D().to;
    if (output.textContent !== (has ? cur.out : '')) output.textContent = has ? cur.out : '';
    output.lang = M.htmlLang(to);
    outCard.classList.toggle('empty', !has);
    outLbl.textContent = E.langName(to);
    const fav = has && !!M.findFav(D(), cur);
    setIcon(favBtn, fav ? 'starFill' : 'star');
    favBtn.classList.toggle('on', fav);
    favBtn.setAttribute('aria-pressed', String(fav));
    favBtn.title = t(fav ? 'interpreter.unfav' : 'interpreter.fav');
    acts.hidden = !has;
    speakBtn.hidden = !E.canSpeak(to);
    setIcon(speakBtn, speakingKey === 'out' ? 'stop' : 'volume');
    speakBtn.classList.toggle('on', speakingKey === 'out');
    speakBtn.title = t(speakingKey === 'out' ? 'interpreter.stop' : 'interpreter.speak');
    srcSpeak.hidden = !input.value.trim() || !E.canSpeak(cur.from || srcCode());
    setIcon(srcSpeak, speakingKey === 'src' ? 'stop' : 'volume', 22);
    clearBtn.hidden = !input.value;
    count.textContent = input.value ? `${input.value.length}/5000` : '';
    goBtn.hidden = P().typing || !input.value.trim();
  }
  function setNote(content, cls = '') {
    note.hidden = !content;
    note.className = 'ip-note ' + cls;
    note.replaceChildren(...(content ? [content].flat() : []));
  }
  function downloadNote(from, to) {
    const lang1 = [from, to].filter((c) => c !== 'en').map(E.langName)[0] || E.langName(to);
    pending = { from, to };
    setNote(h('div', { class: 'ip-dl' },
      h('span', { class: 'ip-dl-ico', html: icon('interpCloud', 22) }),
      h('span', { class: 'ip-dl-text' }, t('interpreter.dlNeeded', { lang: lang1 })),
      h('button', { class: 'ou-btn primary', type: 'button', dataset: { act: 'download' }, onClick: () => run({ gesture: true }) }, t('interpreter.download'))));
  }
  function progressNote(key) {
    const p = E.progressOf(key);
    setNote(h('div', { class: 'ip-prog' }, h('span', null, progressText(p)), h('div', { class: 'ip-bar' }, h('i', { style: { width: Math.round((p || 0) * 100) + '%' } }))));
  }

  async function run({ gesture = false } = {}) {
    const my = ++seq, text = input.value, d = D();
    if (!supported) return;
    if (!text.trim()) {
      cur = { src: '', out: '', from: null, to: null };
      detected = null;
      setNote(null);
      drawLangs();
      drawOut();
      return;
    }
    let from = d.from, to = d.to;
    if (from === 'auto') {
      detected = await E.detect(text);
      if (my !== seq) return;
      from = detected;
      drawLangs();
      if (!from) {
        cur = { ...cur, out: '' };
        drawOut();
        return setNote(t('interpreter.noDetect'), 'muted');
      }
      // typing in the target language translates into the language used before it
      if (from === to) to = d.last && d.last !== to ? d.last : to === 'en' ? 'es' : 'en';
    }
    if (from === to) {
      cur = { src: text, out: text, from, to };
      setNote(null);
      return drawOut();
    }
    const st = await E.pairStatus(from, to);
    if (my !== seq) return;
    if (st === 'unavailable') {
      cur = { src: text, out: '', from, to };
      drawOut();
      return setNote(t('interpreter.pairNA', { from: E.langName(from), to: E.langName(to) }), 'muted');
    }
    if (st === 'downloadable' && !gesture && E.progressOf(`${from}>${to}`) == null) {
      cur = { src: text, out: '', from, to };
      drawOut();
      return downloadNote(from, to);
    }
    pending = null;
    if (st !== 'available') progressNote(`${from}>${to}`);
    else if (!cur.out || cur.to !== to) setNote(dots(), 'muted');
    try {
      const tr = await E.translator(from, to);
      if (my !== seq) return;
      const out = await tr.translate(text);
      if (my !== seq) return;
      cur = { src: text, out, from, to };
      setNote(null);
      drawOut();
      commitSoon();
    } catch (e) {
      if (my !== seq) return;
      console.warn('interpreter', e);
      cur = { src: text, out: '', from, to };
      drawOut();
      if (e?.name === 'NotAllowedError') downloadNote(from, to);
      else setNote(t('interpreter.failed'), 'muted');
    }
  }
  let runTimer = 0;
  const runSoon = () => {
    clearTimeout(runTimer);
    runTimer = setTimeout(run, 320);
  };

  // A finished translation goes into History once you stop typing: one entry per typing session.
  let commitTimer = 0;
  const commitSoon = () => {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, 1600);
  };
  function commit() {
    clearTimeout(commitTimer);
    if (!P().history || !cur.out || !cur.src.trim() || cur.src !== input.value || cur.from === cur.to || cur.src === opened) return;
    sessionId = save((d) => M.addHistory(d, cur, sessionId));
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.max(input.scrollHeight, 104) + 'px';
  }
  input.addEventListener('input', () => {
    opened = null;
    autosize();
    if (!input.value.trim()) {
      seq++;
      sessionId = null;
      cur = { src: '', out: '', from: null, to: null };
      detected = null;
      setNote(null);
      drawLangs();
      drawOut();
      return;
    }
    if (cur.out) outCard.classList.add('stale');
    drawOut();
    if (P().typing) runSoon();
  });
  input.addEventListener('keydown', (e) => {
    // Enter keeps the translation in History (Shift+Enter starts a new line)
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      clearTimeout(runTimer);
      run({ gesture: true }).then(commit);
    }
  });
  input.addEventListener('blur', () => commit());
  new MutationObserver(() => outCard.classList.remove('stale')).observe(output, { childList: true, characterData: true, subtree: true });

  function clearInput() {
    seq++;
    input.value = '';
    sessionId = null;
    detected = null;
    cur = { src: '', out: '', from: null, to: null };
    E.stopSpeaking();
    autosize();
    setNote(null);
    drawLangs();
    drawOut();
    input.focus();
  }

  function load(e, kind) {
    E.stopSpeaking();
    save((d) => {
      d.from = e.from;
      d.to = e.to;
      d.last = e.from;
    });
    input.value = e.src;
    detected = null;
    opened = e.src;
    cur = { src: e.src, out: e.out, from: e.from, to: e.to };
    sessionId = kind === 'hist' ? e.id : null;
    autosize();
    drawLangs();
    drawOut();
    setNote(null);
    run();
  }

  function doSwap() {
    const d = D(), from = srcCode();
    if (!from) return;
    commit();
    const to = cur.to || d.to;
    const text = cur.out && input.value.trim() ? cur.out : input.value;
    save((x) => {
      x.from = to;
      x.to = from;
      x.last = to;
    });
    input.value = text;
    sessionId = null;
    detected = null;
    cur = { src: '', out: '', from: null, to: null };
    autosize();
    drawLangs();
    drawOut();
    run();
  }

  function setLang(which, code) {
    save((d) => {
      if (which === 'from') {
        // picking the target as the source swaps them, as Samsung's pickers do
        if (code !== 'auto' && code === d.to) d.to = d.from === 'auto' ? (detected && detected !== code ? detected : code === 'en' ? 'es' : 'en') : d.from;
        d.from = code;
        if (code !== 'auto') d.last = code;
      } else {
        if (code === d.from) {
          d.from = d.to;
          d.last = d.to;
        }
        d.to = code;
      }
    });
    detected = null;
    cur = { ...cur, out: '' };
    drawLangs();
    drawOut();
    run();
  }

  // dictation into the input, in the source language, where Chrome recognizes it on the device
  let rec = null;
  function drawMic() {
    const code = srcCode();
    micBtn.classList.toggle('on', !!rec);
    if (!code) return void (micBtn.hidden = true);
    S.micStatus(code).then((s) => {
      if (srcCode() === code) micBtn.hidden = s === 'unavailable';
    });
  }
  async function dictate() {
    if (rec) return rec.stop();
    const code = srcCode();
    if (!code) return;
    const base = input.value.trim();
    let said = '';
    const put = (extra = '') => {
      input.value = [base, said, extra].filter(Boolean).join(' ');
      autosize();
      drawOut();
    };
    micBtn.classList.add('on');
    try {
      rec = await S.listen(code, {
        onInterim: (x) => put(x),
        onFinal: (x) => {
          said = [said, x].filter(Boolean).join(' ');
          put();
        },
        onEnd: () => {
          rec = null;
          micBtn.classList.remove('on');
          put();
          run({ gesture: true });
        },
        onError: micError,
      });
    } catch {
      rec = null;
      micBtn.classList.remove('on');
      toast(t('interpreter.micFailed'));
    }
  }

  // History under the cards
  function drawHist() {
    const items = D().history.slice(0, 20);
    if (!items.length) return hist.replaceChildren();
    hist.replaceChildren(
      h('div', { class: 'ip-sec' }, h('span', { class: 'ip-sec-title' }, t('interpreter.history')), h('button', { class: 'ou-btn ip-link', type: 'button', dataset: { act: 'clear-history' }, onClick: clearHistory }, t('interpreter.clear'))),
      h('div', { class: 'ou-card ou-list ip-list' }, items.map((e) => entryRow(e, 'hist', () => load(e, 'hist')))));
  }

  offs.push(store.on(M.KEY, () => {
    drawHist();
    drawLangs();
    drawOut();
  }));
  offs.push(store.on(M.PREFS, () => drawOut()));
  offs.push(E.onProgress(() => {
    if (pending && E.progressOf(`${pending.from}>${pending.to}`) != null) progressNote(`${pending.from}>${pending.to}`);
    else if (!pending && note.querySelector('.ip-prog') && cur.from) progressNote(`${cur.from}>${cur.to}`);
  }));
  speakSubs.add(drawOut);
  offs.push(() => speakSubs.delete(drawOut));
  offs.push(E.onVoices(drawOut));

  // ——— start ———
  const p = params || {};
  drawLangs();
  drawOut();
  drawHist();
  autosize();
  const entry = p.fav || p.hist ? (p.fav ? D().favs : D().history).find((x) => x.id === (p.fav || p.hist)) : null;
  if (entry) load(entry, p.hist ? 'hist' : null);
  else if (p.text) {
    const text = String(p.text);
    save((d) => {
      if (M.LANGS.includes(p.to)) d.to = p.to;
      if (M.LANGS.includes(p.from) && p.from !== d.to) d.from = d.last = p.from;
      else if (E.canDetect()) d.from = 'auto';
      if (d.from === d.to) d.from = d.last !== d.to ? d.last : d.to === 'en' ? 'es' : 'en';
    });
    input.value = text;
    autosize();
    drawLangs();
    drawOut();
    run();
  } else if (M.LANGS.includes(p.to)) {
    // the quick-translate widget opens on its own pair (Widget settings)
    save((d) => {
      d.to = p.to;
      if (M.LANGS.includes(p.from) && p.from !== d.to) d.from = d.last = p.from;
      else if (p.from === 'auto' && E.canDetect()) d.from = 'auto';
      if (d.from === d.to) d.from = d.last !== d.to ? d.last : d.to === 'en' ? 'es' : 'en';
    });
    drawLangs();
    drawOut();
  }
  if (supported && !entry && !p.text) setTimeout(() => input.isConnected && input.focus({ preventScroll: true }), 320);
  void show;

  return () => {
    commit();
    clearTimeout(runTimer);
    clearTimeout(commitTimer);
    rec?.abort?.();
    seq++;
    offs.forEach((f) => f());
  };
}

/** A History or Favourites row: original, translation, the pair, and a star. */
function entryRow(e, kind, onOpen) {
  const fav = kind === 'fav' || !!M.findFav(D(), e);
  const star = h('button', {
    class: ['ou-icon-btn', 'ip-star', fav && 'on'], type: 'button', dataset: { star: '' }, 'aria-pressed': String(fav),
    title: t(fav ? 'interpreter.unfav' : 'interpreter.fav'), 'aria-label': t(fav ? 'interpreter.unfav' : 'interpreter.fav'), html: icon(fav ? 'starFill' : 'star', 20),
    onClick: (ev) => {
      ev.stopPropagation();
      toggleFav(e);
    },
  });
  const r = h('div', {
    class: 'ou-row clickable ip-row', role: 'button', tabindex: 0, dataset: { id: e.id, kind },
    onClick: onOpen,
    onKeydown: (ev) => {
      if (ev.key === 'Enter' && ev.target === r) onOpen();
      if (ev.key === 'Delete') deleteEntry(kind, e);
    },
    onContextmenu: (ev) => {
      ev.preventDefault();
      entryMenu(ev, e, kind);
    },
  },
    h('span', { class: 'ou-row-text' },
      textEl('span', 'ip-row-src', e.src, e.from),
      textEl('span', 'ip-row-out', e.out, e.to),
      h('span', { class: 'ip-row-pair' }, E.pairLabel(e.from, e.to))),
    star);
  onLongPress(r, (ev) => entryMenu(ev, e, kind));
  return r;
}

function micError(err) {
  if (err === 'not-allowed' || err === 'service-not-allowed') toast(t('interpreter.micDenied'));
  else if (err !== 'no-speech' && err !== 'aborted') toast(t('interpreter.micFailed'));
}

// ——— language picker (a One UI list page, like Samsung's "Select language") ———
function pickLang(ctx, { title, current, auto = false, onPick }) {
  ctx.push({
    title,
    hero: false,
    className: 'ip-page ip-pick-page',
    render(body) {
      body.classList.add('ip-body', 'ip-pick');
      const input = h('input', { type: 'search', placeholder: t('interpreter.searchLang'), 'aria-label': t('interpreter.searchLang') });
      const listEl = h('div', { class: 'ou-card ou-list ip-langs', role: 'listbox', 'aria-label': title });
      const rowFor = (c) => {
        const st = c === 'auto' ? 'available' : E.statusOf(c), off = st === 'unavailable', on = c === current;
        const right = on ? h('span', { class: 'ip-check', html: icon('check', 22) })
          : st === 'downloadable' ? h('span', { class: 'ip-cloud', title: t('interpreter.needsDl'), html: icon('interpCloud', 20) })
            : st === 'downloading' ? ring(E.progressOf(c))
              : off ? h('span', { class: 'ip-tag' }, t('interpreter.notAvailable')) : null;
        return h('button', {
          class: ['ou-row', 'clickable', 'ip-lang-row', on && 'on', off && 'off'], type: 'button', role: 'option', 'aria-selected': String(on), disabled: off, dataset: { code: c },
          onClick: () => {
            ctx.pop();
            if (c !== current) onPick(c);
          },
        },
          c === 'auto' ? h('span', { class: 'ou-row-ico', html: icon('sparkle', 20) }) : null,
          h('span', { class: 'ou-row-text' },
            h('span', { class: 'ou-row-title' }, c === 'auto' ? t('interpreter.auto') : E.langName(c)),
            h('span', { class: 'ou-row-sub muted', lang: c === 'auto' ? null : M.htmlLang(c) }, c === 'auto' ? t('interpreter.autoSub') : M.nativeName(c))),
          right);
      };
      const draw = () => {
        const q = input.value.trim().toLowerCase();
        const codes = E.sortedLangs().filter((c) => !q || E.langName(c).toLowerCase().includes(q) || M.nativeName(c).toLowerCase().includes(q) || M.langCode(q) === c);
        const rows = [...(auto && E.canDetect() && !q ? [rowFor('auto')] : []), ...codes.map(rowFor)];
        listEl.replaceChildren(...(rows.length ? rows : [h('div', { class: 'ou-empty' }, t('interpreter.noLang'))]));
      };
      input.addEventListener('input', draw);
      draw();
      E.loadStatuses().then(() => listEl.isConnected && draw());
      body.append(h('label', { class: 'ou-searchbox ip-search' }, h('span', { html: icon('search', 20) }), input), listEl);
      setTimeout(() => listEl.querySelector('.ip-lang-row.on')?.scrollIntoView({ block: 'center' }), 380);
    },
  });
}

// ——— Conversation mode ———
const hints = new Map(); // `${code}:${text}` → the hint in that language
function convoView(ctx, tabs, params, show) {
  const f2fBtn = iconBtn('interpF2F', () => save((d) => void (d.convo.f2f = !d.convo.f2f)), t('interpreter.f2f'));
  f2fBtn.dataset.act = 'f2f';
  const page = ctx.page({ title: t('interpreter.convoMode'), hero: false, className: 'ip-page ip-convo-page', actions: [f2fBtn, moreBtn(() => [
    { label: t('interpreter.swap'), icon: 'interpSwap', onClick: swapSides },
    { label: t('interpreter.clearConvo'), icon: 'trash', danger: true, disabled: !D().convo.msgs.length, onClick: clearConvo },
    '-',
    ...commonItems(ctx),
  ])] });
  page.el.appendChild(tabs);
  page.body.classList.add('ip-convo-body');
  if (!E.supported()) {
    f2fBtn.hidden = true;
    page.body.append(h('div', { class: 'ip-convo-na' }, naState('text')));
    return () => {};
  }

  const busy = new Set(); // ids of messages being translated
  let mic = null; // { side, stop } while one half listens
  const half = (side, top) => {
    const pl = pill();
    pl.dataset.pick = 'cv-' + side;
    pl.addEventListener('click', () => pickLang(ctx, { title: t(side === 'a' ? 'interpreter.yourLang' : 'interpreter.otherLang'), current: D().convo[side], onPick: (c) => setSideLang(side, c) }));
    const speakLast = h('button', { class: 'ou-icon-btn ip-half-speak', type: 'button', hidden: true, title: t('interpreter.speak'), 'aria-label': t('interpreter.speak'), html: icon('volume', 20) });
    const thread = h('div', { class: 'ip-thread scroll' });
    const inp = h('input', { class: 'ip-comp-in', dir: 'auto', autocomplete: 'off', enterkeyhint: 'send', maxlength: 2000 });
    const send = h('button', { class: 'ip-send', type: 'submit', title: t('interpreter.send'), 'aria-label': t('interpreter.send'), html: icon('interpSend', 20) });
    const micB = h('button', { class: 'ip-mic-big', type: 'button', hidden: true, title: t('interpreter.mic'), 'aria-label': t('interpreter.mic'), html: icon('mic', 24), onClick: () => micFor(side) });
    const form = h('form', {
      class: 'ip-comp', dataset: { side },
      onSubmit: (e) => {
        e.preventDefault();
        const v = inp.value;
        inp.value = '';
        sendMsg(side, v);
      },
    }, h('div', { class: 'ip-comp-field' }, inp, send), micB);
    const el = h('section', { class: ['ip-half', top ? 'top' : 'bottom'], dataset: { side } }, h('div', { class: 'ip-half-head' }, pl, h('span', { class: 'ip-sp' }), speakLast), thread, form);
    return { el, pl, thread, inp, micB, form, speakLast };
  };
  const halves = { b: half('b', true), a: half('a', false) };
  const split = h('div', { class: 'ip-split' }, halves.b.el, h('div', { class: 'ip-mid' }, swapButton(swapSides)), halves.a.el);
  page.body.append(split);

  function emptyHint(side, code, hasMic) {
    const base = t(hasMic ? 'interpreter.cvHint' : 'interpreter.cvHintType');
    const txt = h('div', { class: 'ip-cv-hint', dir: 'auto' }, base);
    // Samsung greets each person in their own language: the hint is translated when the pair needs no download
    const k = `${code}:${base}`;
    const put = (s) => {
      txt.textContent = s;
      txt.lang = M.htmlLang(code);
    };
    if (M.baseOf(code) !== lang()) {
      if (hints.has(k)) put(hints.get(k));
      else E.translateText(base, code, lang()).then((r) => {
        if (r.status !== 'ok') return;
        hints.set(k, r.out);
        if (txt.isConnected) put(r.out);
      });
    }
    return h('div', { class: 'ip-cv-empty' }, h('span', { class: 'ip-cv-empty-ico', html: icon(hasMic ? 'mic' : 'interpChat', 28) }), txt);
  }
  function msgEl(m, p, last) {
    const c = D().convo, own = m.side === p, code = own ? c[m.side] : c[M.other(m.side)];
    const text = own ? m.src : m.out;
    let main;
    if (text) main = textEl('div', 'ip-msg-main', text, code);
    else if (busy.has(m.id)) {
      const pr = E.progressOf(`${c[m.side]}>${c[M.other(m.side)]}`);
      main = h('div', { class: 'ip-msg-st' }, pr != null ? progressText(pr) : dots());
    } else main = h('div', { class: 'ip-msg-st' }, t('interpreter.notTranslated'), h('button', { class: 'ip-link-sm', type: 'button', dataset: { retry: m.id }, onClick: () => translateMsg(m.id) }, t('interpreter.retry')));
    const orig = !own && m.out && P().original ? textEl('div', 'ip-msg-orig', m.src, c[m.side]) : null;
    return h('div', { class: ['ip-msg', own && 'own', last && 'last'], dataset: { id: m.id } }, main, orig);
  }
  function drawThreads() {
    const c = D().convo;
    for (const side of ['a', 'b']) {
      const H = halves[side];
      const hasMic = !H.micB.hidden;
      const lastOther = [...c.msgs].reverse().find((m) => m.side !== side && m.out);
      H.thread.replaceChildren(...(c.msgs.length ? c.msgs.map((m, i) => msgEl(m, side, i === c.msgs.length - 1)) : [emptyHint(side, c[side], hasMic)]));
      H.thread.scrollTop = H.thread.scrollHeight;
      // the speaker in each half reads out the latest message translated for that person
      H.speakLast.hidden = !lastOther || !E.canSpeak(c[side]);
      const key = 'last:' + side;
      setIcon(H.speakLast, speakingKey === key ? 'stop' : 'volume');
      H.speakLast.onclick = () => lastOther && speak(key, lastOther.out, c[side]);
    }
  }
  function draw() {
    const c = D().convo;
    split.classList.toggle('f2f', c.f2f);
    f2fBtn.classList.toggle('active', c.f2f);
    f2fBtn.setAttribute('aria-pressed', String(c.f2f));
    for (const side of ['a', 'b']) {
      const H = halves[side], code = c[side];
      setPill(H.pl, E.langName(code));
      H.inp.placeholder = t('interpreter.typeIn', { lang: E.langName(code) });
      H.inp.setAttribute('aria-label', H.inp.placeholder);
      H.inp.lang = M.htmlLang(code);
      H.el.classList.toggle('listening', mic?.side === side);
      H.micB.classList.toggle('on', mic?.side === side);
    }
    drawThreads();
  }
  function drawMics() {
    const c = D().convo;
    for (const side of ['a', 'b']) {
      const code = c[side];
      S.micStatus(code).then((s) => {
        if (D().convo[side] !== code) return;
        const was = halves[side].micB.hidden;
        halves[side].micB.hidden = s === 'unavailable';
        halves[side].form.classList.toggle('has-mic', s !== 'unavailable');
        if (was !== halves[side].micB.hidden && !D().convo.msgs.length) drawThreads();
      });
    }
  }

  function setSideLang(side, code) {
    save((d) => {
      if (d.convo[M.other(side)] === code) d.convo[M.other(side)] = d.convo[side];
      d.convo[side] = code;
    });
    drawMics();
  }
  function swapSides() {
    save((d) => void ([d.convo.a, d.convo.b] = [d.convo.b, d.convo.a]));
    drawMics();
  }
  async function clearConvo() {
    if (!D().convo.msgs.length) return;
    if (await confirm(t('interpreter.clearConvoQ'), t('interpreter.clearConvoMsg'), { okLabel: t('interpreter.clear'), danger: true })) save((d) => void (d.convo.msgs = []));
  }
  function sendMsg(side, text) {
    if (!String(text || '').trim()) return;
    const id = save((d) => M.addMsg(d, side, text.trim()).id);
    translateMsg(id);
  }
  async function translateMsg(id) {
    const c = D().convo, m = c.msgs.find((x) => x.id === id);
    if (!m) return;
    const from = c[m.side], to = c[M.other(m.side)];
    busy.add(id);
    drawThreads();
    let out = '';
    try {
      if (from === to) out = m.src;
      else if ((await E.pairStatus(from, to)) !== 'unavailable') out = await (await E.translator(from, to)).translate(m.src);
    } catch (e) {
      console.warn('interpreter', e);
    }
    busy.delete(id);
    save((d) => {
      const x = d.convo.msgs.find((y) => y.id === id);
      if (x) x.out = out;
    });
    if (out && P().autoSpeak) speak('last:' + M.other(m.side), out, to);
  }
  async function micFor(side) {
    if (mic) {
      const was = mic.side;
      mic.stop();
      if (was === side) return;
    }
    const code = D().convo[side], H = halves[side];
    let said = '';
    mic = { side, stop: () => {} };
    draw();
    try {
      const r = await S.listen(code, {
        onInterim: (x) => (H.inp.value = [said, x].filter(Boolean).join(' ')),
        onFinal: (x) => {
          said = [said, x].filter(Boolean).join(' ');
          H.inp.value = said;
        },
        onEnd: () => {
          if (mic?.side === side) mic = null;
          H.inp.value = '';
          draw();
          sendMsg(side, said);
        },
        onError: micError,
      });
      if (mic?.side === side) mic.stop = r.stop;
    } catch {
      if (mic?.side === side) mic = null;
      draw();
      toast(t('interpreter.micFailed'));
    }
  }

  const offs = [
    store.on(M.KEY, draw),
    store.on(M.PREFS, drawThreads),
    E.onProgress(() => busy.size && drawThreads()),
    E.onVoices(drawThreads),
  ];
  speakSubs.add(drawThreads);
  draw();
  drawMics();
  void params;
  void show;
  return () => {
    offs.forEach((f) => f());
    speakSubs.delete(drawThreads);
    mic?.stop();
  };
}

// ——— Listening mode ———
function listenView(ctx, tabs, params, show) {
  const page = ctx.page({ title: t('interpreter.listenMode'), hero: false, className: 'ip-page ip-listen-page', actions: [moreBtn(() => [
    { label: t('interpreter.clearTranscript'), icon: 'trash', danger: true, disabled: !D().listen.lines.length, onClick: () => save((d) => void (d.listen.lines = [])) },
    '-',
    ...commonItems(ctx),
  ])] });
  page.el.appendChild(tabs);
  page.body.classList.add('ip-body');
  const toConvo = { label: t('interpreter.useConvo'), run: () => show('convo') };
  if (!E.supported()) {
    page.body.append(naState('text'));
    return () => {};
  }
  if (!S.hasOnDevice()) {
    page.body.append(naState('listen', toConvo));
    return () => {};
  }

  const fromBtn = pill(), toBtn = pill();
  fromBtn.dataset.pick = 'listen-from';
  toBtn.dataset.pick = 'listen-to';
  fromBtn.addEventListener('click', () => pickLang(ctx, { title: t('interpreter.speakerLang'), current: D().listen.from, onPick: (c) => setLangs('from', c) }));
  toBtn.addEventListener('click', () => pickLang(ctx, { title: t('interpreter.yourLang'), current: D().listen.to, onPick: (c) => setLangs('to', c) }));
  const swap = swapButton(() => save((d) => void ([d.listen.from, d.listen.to] = [d.listen.to, d.listen.from])));
  const linesEl = h('div', { class: 'ip-lines' });
  const interim = h('div', { class: 'ip-interim', dir: 'auto', hidden: true });
  const note = h('div', { class: 'ip-note muted', hidden: true });
  const transcript = h('div', { class: 'ip-card ip-transcript scroll' }, linesEl, interim);
  const label = h('span', { class: 'ip-listen-lbl' });
  const startBtn = h('button', { class: 'ip-listen-btn', type: 'button', dataset: { act: 'listen' }, onClick: toggle }, h('span', { class: 'ip-listen-ico', html: icon('mic', 22) }), label);
  page.body.append(h('div', { class: 'ip-listen' },
    h('div', { class: 'ip-langbar' }, fromBtn, swap, toBtn),
    h('div', { class: 'ip-langcaps' }, h('span', null, t('interpreter.speakerLang')), h('span'), h('span', null, t('interpreter.yourLang'))),
    transcript, note,
    h('div', { class: 'ip-listen-foot' }, startBtn)));

  let rec = null, starting = false;
  const pairKey = () => `${D().listen.from}>${D().listen.to}`;
  function setLangs(which, code) {
    rec?.stop();
    save((d) => {
      const o = which === 'from' ? 'to' : 'from';
      if (d.listen[o] === code) d.listen[o] = d.listen[which];
      d.listen[which] = code;
    });
  }
  function drawBtn() {
    startBtn.classList.toggle('on', !!rec);
    startBtn.setAttribute('aria-pressed', String(!!rec));
    label.textContent = rec ? t('interpreter.stop') : t('interpreter.start');
    startBtn.querySelector('.ip-listen-ico').innerHTML = icon(rec ? 'stop' : 'mic', 22);
    transcript.classList.toggle('live', !!rec);
  }
  function draw() {
    const d = D().listen, pr = P();
    setPill(fromBtn, E.langName(d.from));
    setPill(toBtn, E.langName(d.to));
    if (!d.lines.length) linesEl.replaceChildren(h('div', { class: 'ip-cv-empty' }, h('span', { class: 'ip-cv-empty-ico', html: icon('interpEar', 28) }), h('div', { class: 'ip-cv-hint' }, t('interpreter.listenHint'))));
    else linesEl.replaceChildren(...d.lines.map((l) => h('div', { class: 'ip-line', dataset: { id: l.id } },
      l.out ? textEl('div', 'ip-line-out', l.out, d.to) : h('div', { class: 'ip-line-out pending' }, dots()),
      pr.original ? textEl('div', 'ip-line-src', l.src, d.from) : null)));
    transcript.scrollTop = transcript.scrollHeight;
    drawBtn();
    S.micStatus(d.from).then((s) => {
      startBtn.disabled = s === 'unavailable' && !rec;
      note.hidden = s !== 'unavailable';
      note.textContent = s === 'unavailable' ? t('interpreter.listenLangNA', { lang: E.langName(d.from) }) : '';
    });
  }
  async function toggle() {
    if (rec) return rec.stop();
    if (starting) return;
    starting = true;
    const { from, to } = D().listen;
    try {
      // the language pack downloads now, while this click still counts as the user's go-ahead
      const st = await E.pairStatus(from, to);
      if (st === 'unavailable') {
        toast(t('interpreter.pairNA', { from: E.langName(from), to: E.langName(to) }));
        return;
      }
      if (st !== 'available') {
        note.hidden = false;
        const off = E.onProgress(() => (note.textContent = progressText(E.progressOf(pairKey()))));
        note.textContent = progressText(null);
        try {
          await E.translator(from, to);
        } finally {
          off();
          note.hidden = true;
        }
      }
      rec = await S.listen(from, {
        continuous: true,
        onInterim: (x) => {
          interim.hidden = !x;
          interim.textContent = x;
          transcript.scrollTop = transcript.scrollHeight;
        },
        onFinal: (x) => {
          interim.hidden = true;
          heard(x, from, to);
        },
        onEnd: () => {
          rec = null;
          interim.hidden = true;
          drawBtn();
        },
        onError: micError,
      });
    } catch (e) {
      console.warn('interpreter', e);
      rec = null;
      toast(t('interpreter.micFailed'));
    } finally {
      starting = false;
      drawBtn();
    }
  }
  async function heard(src, from, to) {
    const id = save((d) => M.addLine(d, src).id);
    let out = '';
    try {
      out = from === to ? src : await (await E.translator(from, to)).translate(src);
    } catch (e) {
      console.warn('interpreter', e);
    }
    save((d) => {
      const l = d.listen.lines.find((x) => x.id === id);
      if (l) l.out = out || '—';
    });
    if (out && P().autoSpeak) speak('line:' + id, out, to);
  }

  const offs = [store.on(M.KEY, draw), store.on(M.PREFS, draw)];
  draw();
  void params;
  return () => {
    offs.forEach((f) => f());
    rec?.stop();
  };
}

// ——— Favourites ———
function favsView(ctx, tabs, params, show) {
  const page = ctx.page({ title: t('interpreter.favsTitle'), className: 'ip-page ip-favs-page', actions: [moreBtn(() => commonItems(ctx))] });
  page.el.appendChild(tabs);
  page.body.classList.add('ip-body');
  const open = (e) => show('text', { fav: e.id });
  const card = (e) => {
    const sp = h('button', { class: 'ou-icon-btn', type: 'button', dataset: { act: 'speak' }, hidden: !E.canSpeak(e.to), title: t('interpreter.speak'), 'aria-label': t('interpreter.speak'), html: icon(speakingKey === 'fav:' + e.id ? 'stop' : 'volume', 20), onClick: (ev) => { ev.stopPropagation(); speak('fav:' + e.id, e.out, e.to); } });
    const el = h('div', {
      class: 'ou-card ip-fav', role: 'button', tabindex: 0, dataset: { id: e.id },
      onClick: () => open(e),
      onKeydown: (ev) => ev.key === 'Enter' && ev.target === el && open(e),
      onContextmenu: (ev) => {
        ev.preventDefault();
        entryMenu(ev, e, 'fav');
      },
    },
      h('div', { class: 'ip-fav-pair' }, E.pairLabel(e.from, e.to)),
      textEl('div', 'ip-fav-src', e.src, e.from),
      textEl('div', 'ip-fav-out', e.out, e.to),
      h('div', { class: 'ip-fav-acts' },
        h('button', { class: 'ou-icon-btn', type: 'button', dataset: { act: 'copy' }, title: t('interpreter.copy'), 'aria-label': t('interpreter.copy'), html: icon('copy', 20), onClick: (ev) => { ev.stopPropagation(); copy(e.out); } }),
        sp,
        h('span', { class: 'ip-sp' }),
        h('button', { class: 'ou-icon-btn ip-star on', type: 'button', dataset: { star: '' }, 'aria-pressed': 'true', title: t('interpreter.unfav'), 'aria-label': t('interpreter.unfav'), html: icon('starFill', 20), onClick: (ev) => { ev.stopPropagation(); deleteEntry('fav', e); } })));
    onLongPress(el, (ev) => entryMenu(ev, e, 'fav'));
    return el;
  };
  const draw = () => {
    const favs = D().favs;
    page.setSubtitle(favs.length ? t(favs.length === 1 ? 'interpreter.nFav1' : 'interpreter.nFavs', { n: favs.length }) : '');
    if (!favs.length) return page.body.replaceChildren(h('div', { class: 'ou-empty ip-empty' }, h('span', { html: icon('star', 56) }), t('interpreter.noFavs'), h('small', null, t('interpreter.noFavsHint'))));
    page.body.replaceChildren(h('div', { class: 'ip-favs' }, favs.map(card)));
  };
  const offs = [store.on(M.KEY, draw), E.onVoices(draw)];
  speakSubs.add(draw);
  draw();
  void params;
  return () => {
    offs.forEach((f) => f());
    speakSubs.delete(draw);
  };
}

const VIEWS = { text: textView, convo: convoView, listen: listenView, favs: favsView };

// ——— Language packs (Settings › Galaxy AI › Language packs on a Galaxy) ———
function languagesPage(ctx) {
  ctx.push({
    title: t('interpreter.packs'),
    subtitle: t('interpreter.packsSub'),
    className: 'ip-page ip-packs-page',
    render(body) {
      body.classList.add('ip-body');
      if (!E.supported()) return void body.append(naState('text'));
      const wrap = h('div', { class: 'ip-packs' }, h('div', { class: 'ip-loading' }, dots()));
      body.append(wrap, h('div', { class: 'ip-foot' }, t('interpreter.packsFoot')));
      const get = (c) => {
        E.download(c).then((ok) => {
          if (!ok) toast(t('interpreter.dlFailed', { lang: E.langName(c) }));
          if (wrap.isConnected) draw();
        });
        draw();
      };
      const right = (c, st) => {
        if (st === 'available') return c === 'en' ? h('span', { class: 'ip-tag' }, t('interpreter.builtIn')) : h('span', { class: 'ip-check', html: icon('check', 22) });
        if (st === 'downloading') return ring(E.progressOf(c));
        if (st === 'downloadable') return h('button', { class: 'ou-icon-btn ip-pack-dl', type: 'button', dataset: { dl: c }, title: t('interpreter.downloadLang', { lang: E.langName(c) }), 'aria-label': t('interpreter.downloadLang', { lang: E.langName(c) }), html: icon('download', 22), onClick: () => get(c) });
        return null;
      };
      const rowFor = (c, st) => {
        const r = row({ title: E.langName(c), sub: M.nativeName(c), className: ['muted-sub', 'ip-pack', st === 'unavailable' && 'off'].filter(Boolean).join(' '), right: right(c, st) });
        r.dataset.code = c;
        r.querySelector('.ou-row-sub').lang = M.htmlLang(c);
        return r;
      };
      function draw() {
        const langs = E.sortedLangs(), st = (c) => E.statusOf(c) || 'unavailable';
        const groups = [
          ['downloaded', langs.filter((c) => st(c) === 'available')],
          ['availableDl', langs.filter((c) => st(c) === 'downloadable' || st(c) === 'downloading')],
          ['notAvailable', langs.filter((c) => st(c) === 'unavailable')],
        ].filter(([, l]) => l.length);
        wrap.replaceChildren(...groups.flatMap(([k, l]) => [subheader(t('interpreter.' + k)), h('div', { class: 'ou-card ou-list', dataset: { group: k } }, l.map((c) => rowFor(c, st(c))))]));
      }
      E.loadStatuses(true).then(() => wrap.isConnected && draw());
      return E.onProgress(() => wrap.isConnected && draw());
    },
  });
}

// ——— Settings ———
function settingsPage(ctx) {
  ctx.push({
    title: t('common.settings'),
    className: 'ip-page ip-settings-page',
    render(body) {
      body.classList.add('ip-body');
      const p = P();
      const voiceSub = h('span', { class: 'ou-row-sub muted' }, '…');
      const voiceRow = row({ icon: 'mic', title: t('interpreter.set.voice') });
      voiceRow.querySelector('.ou-row-text').append(voiceSub);
      S.micStatus(D().convo.a).then((s) => (voiceSub.textContent = t(s === 'unavailable' ? 'interpreter.voiceOff' : 'interpreter.voiceOn')));
      const rate = seg([{ value: 0.75, label: t('interpreter.rate.slow') }, { value: 1, label: t('interpreter.rate.normal') }, { value: 1.25, label: t('interpreter.rate.fast') }], p.rate, (v) => setPref('rate', v));
      body.append(
        list(row({ icon: 'interpCloud', title: t('interpreter.packs'), sub: t('interpreter.packsSub'), className: 'muted-sub', chevron: true, onClick: () => languagesPage(ctx) })),
        subheader(t('interpreter.set.textHead')),
        list(
          switchRow({ title: t('interpreter.set.typing'), sub: t('interpreter.set.typingSub'), checked: p.typing, onChange: (v) => setPref('typing', v) }),
          switchRow({ title: t('interpreter.set.history'), sub: t('interpreter.set.historySub'), checked: p.history, onChange: (v) => setPref('history', v) }),
          row({ title: t('interpreter.clearHistory'), className: 'ip-danger', onClick: clearHistory })),
        subheader(t('interpreter.set.convoHead')),
        list(
          switchRow({ title: t('interpreter.set.original'), sub: t('interpreter.set.originalSub'), checked: p.original, onChange: (v) => setPref('original', v) }),
          switchRow({ title: t('interpreter.set.autoSpeak'), sub: t('interpreter.set.autoSpeakSub'), checked: p.autoSpeak, onChange: (v) => setPref('autoSpeak', v) }),
          h('div', { class: 'ou-row ip-rate-row' }, h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('interpreter.set.rate'))), rate),
          voiceRow),
        h('div', { class: 'ip-foot' }, t('interpreter.packsFoot')));
      body.querySelectorAll('.ou-switch input').forEach((x, i) => (x.dataset.pref = ['typing', 'history', 'original', 'autoSpeak'][i]));
    },
  });
}

addStrings({
  en: {
    'interpreter.tab.text': 'Text',
    'interpreter.tab.convo': 'Conversation',
    'interpreter.tab.listen': 'Listening',
    'interpreter.tab.favs': 'Favourites',
    'interpreter.listenMode': 'Listening mode',
    'interpreter.favsTitle': 'Favourites',
    'interpreter.nFavs': '{n} phrases',
    'interpreter.nFav1': '1 phrase',
    'interpreter.detected': 'Detected',
    'interpreter.autoSub': 'Interpreter finds the language for you',
    'interpreter.enterText': 'Enter text',
    'interpreter.swap': 'Swap languages',
    'interpreter.clear': 'Clear',
    'interpreter.copy': 'Copy',
    'interpreter.copied': 'Copied to clipboard',
    'interpreter.speak': 'Read aloud',
    'interpreter.stop': 'Stop',
    'interpreter.fav': 'Add to Favourites',
    'interpreter.unfav': 'Remove from Favourites',
    'interpreter.favAdded': 'Added to Favourites',
    'interpreter.favRemoved': 'Removed from Favourites',
    'interpreter.translate': 'Translate',
    'interpreter.translating': 'Translating…',
    'interpreter.dlNeeded': 'Download the {lang} language pack to translate on this device.',
    'interpreter.download': 'Download',
    'interpreter.needsDl': 'Needs download',
    'interpreter.downloading': 'Downloading…',
    'interpreter.downloadingN': 'Downloading… {n}%',
    'interpreter.dlFailed': 'Couldn’t download {lang}',
    'interpreter.noDetect': 'Couldn’t detect the language. Choose it from the list.',
    'interpreter.failed': 'Couldn’t translate. Try again.',
    'interpreter.naTitle': 'Translation isn’t available',
    'interpreter.naBody': 'Interpreter uses the on-device translation built into Chrome 138 or later. It needs enough free space and memory, and works offline once a language pack is downloaded.',
    'interpreter.history': 'History',
    'interpreter.clearHistory': 'Clear history',
    'interpreter.clearHistoryQ': 'Clear history?',
    'interpreter.clearHistoryMsg': 'Your recent translations will be removed from this device.',
    'interpreter.noFavs': 'No favourites',
    'interpreter.noFavsHint': 'Tap the star on a translation to save it here.',
    'interpreter.deleted': 'Deleted',
    'interpreter.from': 'Translate from',
    'interpreter.to': 'Translate to',
    'interpreter.searchLang': 'Search languages',
    'interpreter.noLang': 'No languages found',
    'interpreter.packs': 'Language packs',
    'interpreter.packsSub': 'Download languages to translate on this device',
    'interpreter.downloaded': 'Downloaded',
    'interpreter.availableDl': 'Available to download',
    'interpreter.notAvailable': 'Not available',
    'interpreter.builtIn': 'Built in',
    'interpreter.packsFoot': 'Translations happen on this device. Chrome downloads each language pack the first time it’s needed, and what you type or say is never sent anywhere.',
    'interpreter.downloadLang': 'Download {lang}',
    'interpreter.f2f': 'Face-to-face view',
    'interpreter.typeIn': 'Type in {lang}',
    'interpreter.send': 'Send',
    'interpreter.mic': 'Speak',
    'interpreter.cvHint': 'Tap the mic or type to start talking.',
    'interpreter.cvHintType': 'Type a message to start talking.',
    'interpreter.notTranslated': 'Not translated',
    'interpreter.retry': 'Try again',
    'interpreter.clearConvo': 'Clear conversation',
    'interpreter.clearConvoQ': 'Clear conversation?',
    'interpreter.clearConvoMsg': 'All messages in this conversation will be deleted.',
    'interpreter.yourLang': 'Your language',
    'interpreter.otherLang': 'Other person’s language',
    'interpreter.speakerLang': 'Speaker’s language',
    'interpreter.start': 'Start listening',
    'interpreter.listenHint': 'Interpreter listens to the speaker and shows the translation here.',
    'interpreter.listenNA': 'Listening mode isn’t available',
    'interpreter.listenNABody': 'Listening mode needs speech recognition that runs on this device, and Chrome doesn’t offer it here. You can still type in Conversation mode.',
    'interpreter.listenLangNA': 'Voice input isn’t available for {lang} on this device.',
    'interpreter.useConvo': 'Go to Conversation mode',
    'interpreter.clearTranscript': 'Clear transcript',
    'interpreter.micDenied': 'Allow microphone access to use voice input.',
    'interpreter.micFailed': 'Voice input stopped.',
    'interpreter.set.textHead': 'Text translation',
    'interpreter.set.convoHead': 'Conversation and Listening',
    'interpreter.set.typing': 'Translate as you type',
    'interpreter.set.typingSub': 'Show the translation while you’re still typing',
    'interpreter.set.history': 'Save history',
    'interpreter.set.historySub': 'Keep your recent translations on this device',
    'interpreter.set.original': 'Show original text',
    'interpreter.set.originalSub': 'Under each translated message',
    'interpreter.set.autoSpeak': 'Read translations aloud',
    'interpreter.set.autoSpeakSub': 'Speak each new translation with a voice on this device',
    'interpreter.set.rate': 'Speech rate',
    'interpreter.rate.slow': 'Slow',
    'interpreter.rate.normal': 'Normal',
    'interpreter.rate.fast': 'Fast',
    'interpreter.set.voice': 'Voice input',
    'interpreter.voiceOn': 'Uses speech recognition on this device',
    'interpreter.voiceOff': 'Not available in this browser. Type instead.',
  },
  ar: {
    'interpreter.tab.text': 'نص',
    'interpreter.tab.convo': 'محادثة',
    'interpreter.tab.listen': 'استماع',
    'interpreter.tab.favs': 'المفضلة',
    'interpreter.listenMode': 'وضع الاستماع',
    'interpreter.favsTitle': 'المفضلة',
    'interpreter.nFavs': '{n} عبارات',
    'interpreter.nFav1': 'عبارة واحدة',
    'interpreter.detected': 'تم اكتشافها',
    'interpreter.autoSub': 'يكتشف المترجم الفوري اللغة نيابةً عنك',
    'interpreter.enterText': 'أدخل النص',
    'interpreter.swap': 'تبديل اللغتين',
    'interpreter.clear': 'مسح',
    'interpreter.copy': 'نسخ',
    'interpreter.copied': 'تم النسخ إلى الحافظة',
    'interpreter.speak': 'قراءة بصوت عالٍ',
    'interpreter.stop': 'إيقاف',
    'interpreter.fav': 'إضافة إلى المفضلة',
    'interpreter.unfav': 'إزالة من المفضلة',
    'interpreter.favAdded': 'تمت الإضافة إلى المفضلة',
    'interpreter.favRemoved': 'تمت الإزالة من المفضلة',
    'interpreter.translate': 'ترجمة',
    'interpreter.translating': 'جارٍ الترجمة…',
    'interpreter.dlNeeded': 'نزّل حزمة لغة {lang} للترجمة على هذا الجهاز.',
    'interpreter.download': 'تنزيل',
    'interpreter.needsDl': 'تحتاج إلى تنزيل',
    'interpreter.downloading': 'جارٍ التنزيل…',
    'interpreter.downloadingN': 'جارٍ التنزيل… {n}٪',
    'interpreter.dlFailed': 'تعذّر تنزيل {lang}',
    'interpreter.noDetect': 'تعذّر اكتشاف اللغة. اخترها من القائمة.',
    'interpreter.failed': 'تعذّرت الترجمة. حاول مرة أخرى.',
    'interpreter.naTitle': 'الترجمة غير متوفرة',
    'interpreter.naBody': 'يستخدم المترجم الفوري ميزة الترجمة على الجهاز المضمّنة في Chrome 138 أو أحدث. ويحتاج إلى مساحة وذاكرة كافيتين، ويعمل دون اتصال بعد تنزيل حزمة اللغة.',
    'interpreter.history': 'السجل',
    'interpreter.clearHistory': 'مسح السجل',
    'interpreter.clearHistoryQ': 'مسح السجل؟',
    'interpreter.clearHistoryMsg': 'ستتم إزالة ترجماتك الأخيرة من هذا الجهاز.',
    'interpreter.noFavs': 'لا توجد مفضلة',
    'interpreter.noFavsHint': 'اضغط على النجمة في ترجمة لحفظها هنا.',
    'interpreter.deleted': 'تم الحذف',
    'interpreter.from': 'الترجمة من',
    'interpreter.to': 'الترجمة إلى',
    'interpreter.searchLang': 'البحث عن اللغات',
    'interpreter.noLang': 'لم يتم العثور على لغات',
    'interpreter.packs': 'حزم اللغات',
    'interpreter.packsSub': 'نزّل اللغات للترجمة على هذا الجهاز',
    'interpreter.downloaded': 'تم التنزيل',
    'interpreter.availableDl': 'متاحة للتنزيل',
    'interpreter.notAvailable': 'غير متوفرة',
    'interpreter.builtIn': 'مضمّنة',
    'interpreter.packsFoot': 'تتم الترجمة على هذا الجهاز. ينزّل Chrome كل حزمة لغة عند الحاجة إليها لأول مرة، ولا يتم إرسال ما تكتبه أو تقوله إلى أي مكان.',
    'interpreter.downloadLang': 'تنزيل {lang}',
    'interpreter.f2f': 'عرض وجهًا لوجه',
    'interpreter.typeIn': 'اكتب باللغة {lang}',
    'interpreter.send': 'إرسال',
    'interpreter.mic': 'تحدّث',
    'interpreter.cvHint': 'اضغط على الميكروفون أو اكتب لبدء الحديث.',
    'interpreter.cvHintType': 'اكتب رسالة لبدء الحديث.',
    'interpreter.notTranslated': 'لم تتم الترجمة',
    'interpreter.retry': 'إعادة المحاولة',
    'interpreter.clearConvo': 'مسح المحادثة',
    'interpreter.clearConvoQ': 'مسح المحادثة؟',
    'interpreter.clearConvoMsg': 'سيتم حذف كل الرسائل في هذه المحادثة.',
    'interpreter.yourLang': 'لغتك',
    'interpreter.otherLang': 'لغة الشخص الآخر',
    'interpreter.speakerLang': 'لغة المتحدث',
    'interpreter.start': 'بدء الاستماع',
    'interpreter.listenHint': 'يستمع المترجم الفوري إلى المتحدث ويعرض الترجمة هنا.',
    'interpreter.listenNA': 'وضع الاستماع غير متوفر',
    'interpreter.listenNABody': 'يحتاج وضع الاستماع إلى التعرّف على الكلام على هذا الجهاز، ولا يوفّره Chrome هنا. لا يزال بإمكانك الكتابة في وضع المحادثة.',
    'interpreter.listenLangNA': 'الإدخال الصوتي غير متوفر للغة {lang} على هذا الجهاز.',
    'interpreter.useConvo': 'الانتقال إلى وضع المحادثة',
    'interpreter.clearTranscript': 'مسح النص',
    'interpreter.micDenied': 'اسمح بالوصول إلى الميكروفون لاستخدام الإدخال الصوتي.',
    'interpreter.micFailed': 'توقف الإدخال الصوتي.',
    'interpreter.set.textHead': 'ترجمة النص',
    'interpreter.set.convoHead': 'المحادثة والاستماع',
    'interpreter.set.typing': 'الترجمة أثناء الكتابة',
    'interpreter.set.typingSub': 'عرض الترجمة بينما لا تزال تكتب',
    'interpreter.set.history': 'حفظ السجل',
    'interpreter.set.historySub': 'الاحتفاظ بترجماتك الأخيرة على هذا الجهاز',
    'interpreter.set.original': 'عرض النص الأصلي',
    'interpreter.set.originalSub': 'أسفل كل رسالة مترجمة',
    'interpreter.set.autoSpeak': 'قراءة الترجمات بصوت عالٍ',
    'interpreter.set.autoSpeakSub': 'نطق كل ترجمة جديدة بصوت موجود على هذا الجهاز',
    'interpreter.set.rate': 'معدل الكلام',
    'interpreter.rate.slow': 'بطيء',
    'interpreter.rate.normal': 'عادي',
    'interpreter.rate.fast': 'سريع',
    'interpreter.set.voice': 'الإدخال الصوتي',
    'interpreter.voiceOn': 'يستخدم التعرّف على الكلام على هذا الجهاز',
    'interpreter.voiceOff': 'غير متوفر في هذا المتصفح. اكتب بدلاً من ذلك.',
  },
});
