// Interpreter (Samsung Interpreter / Galaxy AI translation): registration, widget, Finder command and search, Quick
// Panel tile. The app itself (js/interpreter/ui.js) loads when it opens; translation runs only with Chrome's
// on-device Translator and LanguageDetector (js/interpreter/engine.js), which also load on first use.
import { h } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerCommand, registerTile } from '../core/hooks.js';
import { store } from '../core/store.js';
import { addStrings, t, lang } from '../core/i18n.js';
import { dialog } from '../core/ui.js';
import * as M from '../interpreter/model.js';
import '../interpreter/actions.js'; // Modes and Routines: Translate text

addIcons({
  interpApp: '<path d="M3.8 6.2a2.4 2.4 0 0 1 2.4-2.4h6.6a2.4 2.4 0 0 1 2.4 2.4v4.4a2.4 2.4 0 0 1-2.4 2.4H9.6L6.4 15.6V13a2.4 2.4 0 0 1-2.6-2.4Z"/><path d="M17.6 9.4a2.4 2.4 0 0 1 2.6 2.4v4.4a2.4 2.4 0 0 1-2.4 2.4v2.6l-3.2-2.6h-2.4a2.4 2.4 0 0 1-2.4-2.4v-1"/><path d="m7.1 10.4 2.4-5 2.4 5M7.9 8.8h3.2"/>',
  interpTranslate: '<path d="M3.5 6h9M8 4v2M10.6 6c-.7 3.4-2.8 6-6.1 7.6M5.9 9.1c1.1 1.9 2.9 3.4 5 4.4"/><path d="m11.5 20.5 4-9.5h.4l4 9.5M12.9 17.3h5.6"/>',
  interpSwap: '<path d="M4.5 8.5h14.5M15.5 5l3.5 3.5-3.5 3.5M19.5 15.5H5M8.5 12 5 15.5 8.5 19"/>',
  interpChat: '<path d="M3.5 9.5C3.5 6.5 6.2 4 9.5 4s6 2.5 6 5.5S12.8 15 9.5 15c-.8 0-1.5-.1-2.2-.4L4 16l.9-2.6a5.3 5.3 0 0 1-1.4-3.9Z"/><path d="M17.6 9.6c1.8.8 2.9 2.4 2.9 4.2 0 1.2-.5 2.3-1.3 3.1l.8 2.6-3.2-1.3c-.6.2-1.3.3-2 .3-2 0-3.7-.9-4.6-2.3"/>',
  interpEar: '<path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 2.4-1.2 3.6-2.3 4.6-1 .9-1.3 1.6-1.6 2.9a2.8 2.8 0 0 1-2.8 2.5c-1.2 0-2.1-.6-2.6-1.6"/><path d="M9.6 10a2.4 2.4 0 0 1 4.8 0c0 1.1-.7 1.6-1.4 2.1"/><path d="M19.8 6.5a8 8 0 0 1 1 3.3M4.2 6.5a8 8 0 0 0-1 3.3"/>',
  interpF2F: '<rect x="4.5" y="3" width="15" height="18" rx="3"/><path d="M4.5 12h15"/><path d="m9.5 6.5 2.5 2 2.5-2M9.5 17.5l2.5-2 2.5 2"/>',
  interpSend: '<path d="M4.6 11.4 19.4 4.6l-6.8 14.8-2.1-6-5.9-2Z"/><path d="m10.5 13.4 4-4"/>',
  interpCloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-8A6 6 0 0 0 6.6 9.3 4.6 4.6 0 0 0 7 18.5Z"/><path d="M12 10.5v5.5M9.6 13.8l2.4 2.4 2.4-2.4"/>',
});

const data = () => M.norm(store.get(M.KEY), lang());
const name = (code) => M.nameOf(code, lang());
const pair = (from, to) => t('interpreter.pair', { from: from === 'auto' ? t('interpreter.auto') : name(from), to: name(to) });

registerApp({
  id: 'interpreter',
  name: 'app.interpreter',
  icon: {
    bg: 'linear-gradient(150deg, #4fa3ff 0%, #5b6cff 52%, #9a5bf5 100%)',
    glyph: '<path d="M3.6 6.1a2.5 2.5 0 0 1 2.5-2.5h6.8a2.5 2.5 0 0 1 2.5 2.5v4.6a2.5 2.5 0 0 1-2.5 2.5H9.5l-3.3 2.7v-2.7a2.6 2.6 0 0 1-2.6-2.5Z"/><path d="M17.8 9.5a2.6 2.6 0 0 1 2.6 2.5v4.6a2.5 2.5 0 0 1-2.5 2.5v2.7l-3.3-2.7h-2.5a2.5 2.5 0 0 1-2.5-2.5v-1"/><path d="m7.1 10.4 2.4-5.1 2.4 5.1M7.9 8.8h3.2"/>',
  },
  keywords: ['translate', 'translator', 'interpreter', 'galaxy ai', 'conversation', 'ترجمة', 'مترجم', 'المترجم الفوري', 'ترجم'],
  render: (ctx) => import('../interpreter/ui.js').then((m) => m.render(ctx)),
  search(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2 || M.parseCommand(q)) return [];
    const d = data(), seen = new Set(), out = [];
    for (const [kind, e] of [...d.favs.map((x) => ['fav', x]), ...d.history.map((x) => ['hist', x])]) {
      const k = `${e.src}\n${e.to}`;
      if (seen.has(k) || !(e.src.toLowerCase().includes(q) || e.out.toLowerCase().includes(q))) continue;
      seen.add(k);
      out.push({ title: e.src, sub: `${e.out} · ${pair(e.from, e.to)}`, icon: 'interpTranslate', onOpen: () => openApp('interpreter', { params: { tab: 'text', [kind]: e.id } }) });
      if (out.length >= 4) break;
    }
    return out;
  },
});

// ——— Finder: "translate good morning to Spanish", "ترجم صباح الخير إلى الإنجليزية" ———
// The command answers inline (Samsung's Finder shows the translation right in the results) and Enter opens the app
// with the text. Nothing is downloaded from Finder: a missing language pack is offered in the app.
const answers = new Map(); // `${from}>${to}:${text}` → result of engine.translateText
let pending = 0;
function fillAnswer(cmd, titleEl, subEl) {
  const key = `${cmd.from || ''}>${cmd.to}:${cmd.text}`;
  const put = (r) => {
    const msg = (s) => {
      titleEl.textContent = s;
      titleEl.classList.add('ip-fr-msg');
      titleEl.removeAttribute('lang');
    };
    if (r.status === 'ok') {
      titleEl.textContent = r.out;
      titleEl.classList.remove('ip-fr-msg');
      titleEl.lang = M.htmlLang(cmd.to);
      subEl.textContent = `${t('app.interpreter')} · ${pair(r.from, cmd.to)}`;
    } else if (r.status === 'unsupported') msg(t('interpreter.cmdNA'));
    else if (r.status === 'downloadable') msg(t('interpreter.cmdDl', { lang: name([r.from, cmd.to].find((c) => c && c !== 'en') || cmd.to) }));
    else if (r.status === 'unavailable') msg(t('interpreter.pairNA', { from: name(r.from), to: name(cmd.to) }));
    else msg(t('interpreter.cmdOpen', { text: cmd.text }));
    if (r.status !== 'ok') subEl.textContent = t('interpreter.cmdOpenApp');
  };
  if (answers.has(key)) return put(answers.get(key));
  clearTimeout(pending);
  pending = setTimeout(async () => {
    try {
      const E = await import('../interpreter/engine.js');
      const r = await E.translateText(cmd.text, cmd.to, cmd.from);
      if (r.status !== 'error') answers.set(key, r);
      if (answers.size > 40) answers.delete(answers.keys().next().value);
      put(r);
    } catch (e) {
      console.warn('interpreter', e);
      put({ status: 'error' });
    }
  }, 160);
}

registerCommand('interpreter', (q, lower, done) => {
  const cmd = M.parseCommand(q);
  if (!cmd?.text) return [];
  const run = () => {
    done?.();
    // the source language the inline answer found travels with the text, so the app shows the same translation
    const from = cmd.from || answers.get(`>${cmd.to}:${cmd.text}`)?.from || null;
    openApp('interpreter', { params: { tab: 'text', text: cmd.text, to: cmd.to, from } });
  };
  if (!cmd.to) return [{ icon: 'interpTranslate', title: t('interpreter.cmdOpen', { text: cmd.text }), sub: t('app.interpreter'), run }];
  const title = h('span', { class: 'ip-fr-out', dir: 'auto' }, t('interpreter.translatingTo', { lang: name(cmd.to) }));
  const sub = h('span', { class: 'ip-fr-sub' }, `${t('app.interpreter')} · ${cmd.from ? pair(cmd.from, cmd.to) : name(cmd.to)}`);
  fillAnswer(cmd, title, sub);
  return [{ icon: 'interpTranslate', title, sub, answer: true, run }];
});

// ——— Quick Panel: Interpreter opens straight into Conversation mode, like Samsung's tile ———
registerTile({
  id: 'interpreter',
  icon: 'interpApp',
  label: () => t('app.interpreter'),
  on: () => false,
  order: 60,
  toggle() {
    import('../shell/lock.js').then((m) => m.unlock()).then(() => openApp('interpreter', { params: { tab: 'convo' } }));
    return true;
  },
});

// ——— widget: quick translate (small) or your newest favourite phrase (medium) ———
/** The widget's own language pair from its settings ({} when it follows the app). */
const pairOf = (config) => (M.LANGS.includes(config?.to) ? { to: config.to, from: config.from === 'auto' || M.LANGS.includes(config.from) ? config.from : 'auto' } : {});
registerWidget({
  id: 'interpreter',
  name: 'interpreter.widget',
  sizes: ['s', 'm'],
  defaultSize: 's',
  app: 'interpreter',
  onClick(item, el) {
    const f = item.size === 'm' && data().favs[0];
    openApp('interpreter', { from: el, params: f ? { tab: 'text', fav: f.id } : { tab: 'text', focus: true, ...pairOf(item.config) } });
  },
  // Widget settings: the language pair the quick-translate widget opens with (the app's own pair until one is chosen)
  async configure(config) {
    const d = data(), langs = [...M.LANGS].map((c) => [c, name(c)]).sort((a, b) => a[1].localeCompare(b[1], lang()));
    const select = (label, value, auto) => h('label', { class: 'ip-wcfg-row' }, h('span', { class: 'ip-wcfg-label' }, label),
      h('select', { class: 'ou-input', 'aria-label': label },
        auto ? h('option', { value: 'auto', selected: value === 'auto' }, t('interpreter.auto')) : null,
        langs.map(([c, n]) => h('option', { value: c, selected: c === value }, n))));
    const from = select(t('interpreter.w.pickFrom'), config.from || d.from, true), to = select(t('interpreter.w.pickTo'), config.to || d.to, false);
    const v = await dialog({
      title: t('interpreter.w.pair'),
      content: h('div', { class: 'ou-dialog-body ip-wcfg' }, from, to),
      actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), primary: true, value: () => ({ from: from.querySelector('select').value, to: to.querySelector('select').value }) }],
    });
    if (!v) return null;
    // the same language on both sides: start from the other side's usual partner, as the app's swap does
    if (v.from === v.to) v.from = v.to === 'en' ? 'auto' : 'en';
    return { ...config, ...v };
  },
  render(el, { size, config }) {
    el.classList.add('wg-interp');
    const go = (params) => (e) => {
      e.stopPropagation();
      openApp('interpreter', { from: el, params });
    };
    const draw = () => {
      const d = data(), f = size === 'm' ? d.favs[0] : null;
      const head = h('div', { class: 'wg-head wg-interp-head' }, h('span', { class: 'wg-interp-ico', html: icon('interpApp', 15) }), h('span', null, t(f ? 'interpreter.favourite' : 'app.interpreter')));
      if (f) {
        el.classList.add('fav');
        el.replaceChildren(head,
          h('div', { class: 'wg-interp-pair' }, pair(f.from, f.to)),
          h('div', { class: 'wg-interp-src', dir: 'auto', lang: M.htmlLang(f.from) }, f.src),
          h('div', { class: 'wg-interp-out', dir: 'auto', lang: M.htmlLang(f.to) }, f.out));
        return;
      }
      el.classList.remove('fav');
      const own = pairOf(config), from = own.from || d.from, to = own.to || d.to;
      el.replaceChildren(head,
        h('div', { class: 'wg-interp-langs' },
          h('span', null, from === 'auto' ? t('interpreter.auto') : name(from)),
          h('span', { class: 'wg-interp-arrow', html: icon('interpSwap', 16) }),
          h('span', null, name(to))),
        h('div', { class: 'wg-interp-row' },
          h('button', { class: 'wg-interp-field', onClick: go({ tab: 'text', focus: true, ...own }) }, h('span', { html: icon('interpTranslate', 18) }), h('span', null, t('interpreter.widgetTap'))),
          h('button', { class: 'wg-interp-btn', title: t('interpreter.convoMode'), 'aria-label': t('interpreter.convoMode'), html: icon('interpChat', 20), onClick: go({ tab: 'convo' }) })));
    };
    draw();
    return store.on(M.KEY, draw);
  },
});

addStrings({
  en: {
    'app.interpreter': 'Interpreter',
    'interpreter.widget': 'Interpreter',
    'interpreter.favourite': 'Favourite phrase',
    'interpreter.widgetTap': 'Tap to translate',
    'interpreter.convoMode': 'Conversation mode',
    'interpreter.auto': 'Auto detect',
    'interpreter.pair': '{from} → {to}',
    'interpreter.translatingTo': 'Translating to {lang}…',
    'interpreter.cmdOpen': 'Translate “{text}”',
    'interpreter.cmdOpenApp': 'Open in Interpreter',
    'interpreter.cmdNA': 'Translation isn’t available on this device',
    'interpreter.cmdDl': 'Download {lang} in Interpreter to translate',
    'interpreter.pairNA': 'Translating from {from} to {to} isn’t available on this device.',
  },
  ar: {
    'app.interpreter': 'المترجم الفوري',
    'interpreter.widget': 'المترجم الفوري',
    'interpreter.favourite': 'عبارة مفضلة',
    'interpreter.widgetTap': 'اضغط للترجمة',
    'interpreter.convoMode': 'وضع المحادثة',
    'interpreter.auto': 'اكتشاف تلقائي',
    'interpreter.pair': '{from} ← {to}',
    'interpreter.translatingTo': 'جارٍ الترجمة إلى {lang}…',
    'interpreter.cmdOpen': 'ترجمة "{text}"',
    'interpreter.cmdOpenApp': 'فتح في المترجم الفوري',
    'interpreter.cmdNA': 'الترجمة غير متوفرة على هذا الجهاز',
    'interpreter.cmdDl': 'نزّل {lang} في المترجم الفوري للترجمة',
    'interpreter.pairNA': 'الترجمة من {from} إلى {to} غير متوفرة على هذا الجهاز.',
  },
});
