// Interpreter's action for Modes and Routines ("Then"): Translate text, on the device only (Chrome's Translator API),
// with its result usable by the next actions (Show notification, New note…). Nothing is downloaded from a routine: a
// missing language pack is an error that says to download it in Interpreter. Runs in a page (the Translator API isn't
// available to the service worker). Imported by js/apps/interpreter.js.
import { registerAction, RunError, toText } from '../routines/actions.js';
import { addStrings, lang } from '../core/i18n.js';
import * as M from './model.js';

const byName = () => [...M.LANGS].map((c) => [c, M.nameOf(c, lang())]).sort((a, b) => a[1].localeCompare(b[1], lang()));

registerAction({
  id: 'interpreter.translate', name: 'interpreter.ra.translate', icon: 'interpTranslate', color: '#5b6cff', cat: 'apps', out: 'interpreter.ra.out',
  params: [
    { key: 'text', type: 'text', label: 'interpreter.ra.text', input: true, multiline: true },
    // getters: language names in the UI language of the moment (labels that aren't i18n keys are shown as they are)
    { key: 'to', type: 'enum', label: 'interpreter.ra.to', def: 'en', get opts() { return byName(); } },
    { key: 'from', type: 'enum', label: 'interpreter.ra.from', def: 'auto', get opts() { return [['auto', 'interpreter.auto'], ...byName()]; } },
  ],
  sub: (p, F) => [F.text(p.text), M.nameOf(p.to || 'en', lang())].filter(Boolean).join(' → '),
  async run(ctx, p) {
    const text = toText(p.text ?? '').trim(), to = M.LANGS.includes(p.to) ? p.to : 'en';
    if (!text) throw new RunError('interpreter.ra.errEmpty');
    const E = await import('./engine.js');
    const r = await E.translateText(text, to, M.LANGS.includes(p.from) ? p.from : null);
    if (r.status === 'ok') return r.out;
    const name = (c) => M.nameOf(c, lang());
    if (r.status === 'unsupported') throw new RunError('interpreter.cmdNA');
    if (r.status === 'downloadable') throw new RunError('interpreter.cmdDl', { lang: name([r.from, to].find((c) => c && c !== 'en') || to) });
    if (r.status === 'unavailable') throw new RunError('interpreter.pairNA', { from: name(r.from), to: name(to) });
    if (r.status === 'nodetect') throw new RunError('interpreter.ra.errDetect');
    throw new RunError('interpreter.ra.errFailed');
  },
});

addStrings({
  en: {
    'interpreter.ra.translate': 'Translate text', 'interpreter.ra.text': 'Text', 'interpreter.ra.to': 'Translate to', 'interpreter.ra.from': 'Translate from',
    'interpreter.ra.out': 'Translated text', 'interpreter.ra.errEmpty': 'There’s no text to translate.',
    'interpreter.ra.errDetect': 'Interpreter couldn’t tell which language the text is in. Choose it in Translate from.',
    'interpreter.ra.errFailed': 'The text couldn’t be translated. Try again.',
    'interpreter.w.pickFrom': 'Translate from', 'interpreter.w.pickTo': 'Translate to', 'interpreter.w.pair': 'Languages',
  },
  ar: {
    'interpreter.ra.translate': 'ترجمة النص', 'interpreter.ra.text': 'النص', 'interpreter.ra.to': 'الترجمة إلى', 'interpreter.ra.from': 'الترجمة من',
    'interpreter.ra.out': 'النص المترجم', 'interpreter.ra.errEmpty': 'لا يوجد نص لترجمته.',
    'interpreter.ra.errDetect': 'تعذّر على المترجم الفوري معرفة لغة النص. اخترها في ”الترجمة من“.',
    'interpreter.ra.errFailed': 'تعذّرت ترجمة النص. حاول مرة أخرى.',
    'interpreter.w.pickFrom': 'الترجمة من', 'interpreter.w.pickTo': 'الترجمة إلى', 'interpreter.w.pair': 'اللغات',
  },
});
