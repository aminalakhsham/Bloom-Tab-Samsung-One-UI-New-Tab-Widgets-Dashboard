// Samsung Calculator: registration, Finder commands and the maths other surfaces import. The app itself (keypad with
// live result, scientific keys, History, Unit converter and Tip calculator) loads from js/calc/ui.js when it opens.
// The maths engine and unit tables are js/calc/engine.js and js/calc/units.js (shared with Finder); evaluate() and
// formatNumber() below are the keypad's flavour of them (degrees, 12 significant digits, grouping in the UI language)
// for the side panel and older callers.
import { registerApp, openApp } from '../core/apps.js';
import { registerCommand } from '../core/hooks.js';
import { addIcons } from '../core/icons.js';
import { addStrings, t } from '../core/i18n.js';

export { evaluate, formatNumber } from '../calc/model.js';

addIcons({
  calcRuler: '<path d="m3.6 15.4 11.8-11.8a1.4 1.4 0 0 1 2 0l3 3a1.4 1.4 0 0 1 0 2L8.6 20.4a1.4 1.4 0 0 1-2 0l-3-3a1.4 1.4 0 0 1 0-2Z"/><path d="m7.5 11.5 2 2M10.5 8.5l2 2M13.5 5.5l2 2"/>',
  calcSci: '<path d="M2.5 13h2.6l2.8 6.5L12.4 4.5h9.1"/><path d="m14.5 11.5 6 6m0-6-6 6"/>',
  calcSwap: '<path d="M8 20V4M4.5 7.5 8 4l3.5 3.5M16 4v16M12.5 16.5 16 20l3.5-3.5"/>',
});

// "unit converter", "convert", "tip" open the converter straight away
const CONVERTER = /^(unit\s*)?(converter|convert|conversion)s?$|^units$|^محول(\s*ال)?\s*وحدات$|^محول$|^تحويل\s*(ال)?وحدات$/i;
const TIP = /^tip(\s*calc(ulator)?)?$|^بقشيش$|^حاسبة\s*(ال)?بقشيش$/i;
registerCommand('calculator', (q, lower, done) => {
  const s = lower.trim();
  const tip = TIP.test(s);
  if (!tip && !CONVERTER.test(s)) return [];
  return [{
    icon: 'calcRuler',
    title: t(tip ? 'calc.tipCalc' : 'calc.converter'),
    sub: t('app.calculator'),
    score: 92,
    run: () => {
      done?.();
      openApp('calculator', { params: { section: tip ? 'tip' : 'converter' } });
    },
  }];
});

registerApp({
  id: 'calculator',
  name: 'app.calculator',
  icon: {
    bg: 'linear-gradient(145deg, #5fd36b 0%, #19a35a 100%)',
    glyph: '<path d="M6 7.5h4M8 5.5v4M14.5 7.5h4M6.2 15.2l3.6 3.6M9.8 15.2l-3.6 3.6M14.5 15.5h4M14.5 18.5h4"/>',
  },
  keywords: ['calc', 'math', 'unit converter', 'tip', 'حاسبة', 'حساب', 'محول الوحدات'],
  size: 'phone',
  render: (ctx) => import('../calc/ui.js').then((m) => m.render(ctx)),
});

addStrings({
  en: {
    'app.calculator': 'Calculator',
    'calc.converter': 'Unit converter',
    'calc.tipCalc': 'Tip calculator',
  },
  ar: {
    'app.calculator': 'الآلة الحاسبة',
    'calc.converter': 'محول الوحدات',
    'calc.tipCalc': 'حاسبة البقشيش',
  },
});
