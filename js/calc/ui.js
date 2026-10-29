// Samsung Calculator (One UI): the display with the live result under the expression, the toolbar (History, Unit
// converter, Scientific mode, ⌫), the keypad (C, ( ), %, ÷ … =) and, in Scientific mode, three columns of scientific
// keys in front of it (⇄ for the second functions, Rad/Deg, √, sin/cos/tan, ln/log, 1/x, eˣ, x², xʸ, |x|, π, e).
// History slides over the digit keys and leaves the operator column usable, like Samsung's. In a wide window the
// scientific keys are always there, as on a Galaxy tablet in landscape. The input rules are js/calc/model.js.
import { h, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { addStrings, t } from '../core/i18n.js';
import { toast, menu } from '../core/ui.js';
import * as M from './model.js';
import { tokenize, latinDigits } from './engine.js';

export const BACKSPACE = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6.2-7L9 5Z"/><path d="m12 9.5 5 5M17 9.5l-5 5"/></svg>';

// [key, label, kind]: the One UI keypad
const MAIN = [
  ['C', 'C', 'clear'], ['()', '( )', 'op'], ['%', '%', 'op'], ['/', '÷', 'op'],
  ['7'], ['8'], ['9'], ['*', '×', 'op'],
  ['4'], ['5'], ['6'], ['-', '−', 'op'],
  ['1'], ['2'], ['3'], ['+', '+', 'op'],
  ['+/-', '+/−'], ['0'], ['.'], ['=', '=', 'eq'],
];
// Scientific keys, three in front of each keypad row: [key, key with ⇄ on]
const SCI = [
  [['2nd'], ['deg'], ['sqrt', 'cbrt']],
  [['sin', 'asin'], ['cos', 'acos'], ['tan', 'atan']],
  [['ln', 'exp'], ['log', 'pow10'], ['inv', '!']],
  [['exp', 'pow2'], ['sq', 'cube'], ['pow', 'root']],
  [['abs'], ['π'], ['e']],
];
const INV = '<sup>−1</sup>';
export const SCI_HTML = {
  '2nd': '⇄', sqrt: '√', cbrt: '∛', sin: 'sin', cos: 'cos', tan: 'tan', asin: 'sin' + INV, acos: 'cos' + INV, atan: 'tan' + INV,
  ln: 'ln', log: 'log', inv: '1/x', '!': 'x!', exp: 'e<sup>x</sup>', pow10: '10<sup>x</sup>', pow2: '2<sup>x</sup>', sq: 'x<sup>2</sup>',
  cube: 'x<sup>3</sup>', pow: 'x<sup>y</sup>', root: '<sup>y</sup>√x', abs: '|x|', 'π': 'π', e: 'e',
};
const SCI_NAME = {
  '2nd': '2nd', sqrt: '√', cbrt: '∛', asin: 'sin⁻¹', acos: 'cos⁻¹', atan: 'tan⁻¹', inv: '1/x', '!': 'x!', exp: 'eˣ', pow10: '10ˣ', pow2: '2ˣ',
  sq: 'x²', cube: 'x³', pow: 'xʸ', root: 'ʸ√x', abs: '|x|',
};
// keyboard → keys (digits in any script go through latinDigits)
const KEYMAP = { Enter: '=', '=': '=', Backspace: 'back', Delete: 'C', x: '*', X: '*', '×': '*', '÷': '/', '٪': '%', '٫': '.', '−': '-' };

// What you typed survives closing the window in this tab, as Samsung's calculator keeps it
let mem = { expr: '', done: false };

const prefs = () => store.get('calcPrefs') || {};
export const setPrefs = (patch) => store.update('calcPrefs', (p) => ({ ...(p || {}), ...patch }));

/** Copies text to the clipboard with Samsung's toast. */
export function copy(text) {
  if (!text) return;
  Promise.resolve(navigator.clipboard?.writeText(String(text))).then(() => toast(t('calc.copied')), () => toast(t('calc.copyFailed')));
}

export function render(ctx) {
  let state = { ...mem };
  let deg = prefs().deg !== false;
  let sci = !!prefs().sci;
  let second = false;
  let showHistory = false;
  let wide = false;

  const modeEl = h('div', { class: 'calc-mode', hidden: true }, 'Rad');
  const exprEl = h('div', { class: 'calc-expr', dir: 'ltr' });
  const previewEl = h('div', { class: 'calc-preview', dir: 'ltr' });
  const display = h('div', { class: 'calc-display' }, modeEl, h('div', { class: 'calc-lines' }, exprEl, previewEl));

  const tool = (name, title, onClick) => h('button', { class: 'ou-icon-btn calc-tool', title, 'aria-label': title, html: icon(name, 24), onClick });
  const histBtn = tool('history', t('calc.history'), () => { showHistory = !showHistory; drawPad(); drawTools(); });
  const convBtn = tool('calcRuler', t('calc.converter'), () => openConverter());
  const sciBtn = tool('calcSci', t('calc.scientific'), () => { sci = !sci; second = false; setPrefs({ sci }); drawPad(); drawTools(); });
  const backBtn = h('button', { class: 'ou-icon-btn calc-back-key', title: t('calc.backspace'), 'aria-label': t('calc.backspace'), 'data-k': 'back', html: BACKSPACE, onClick: () => press('back') });
  const tools = h('div', { class: 'calc-tools' }, histBtn, convBtn, sciBtn, h('span', { class: 'calc-tools-gap' }), backBtn);

  const pad = h('div', { class: 'calc-pad' });
  const root = h('div', { class: 'calc' }, display, tools, pad);

  const page = ctx.page({ title: '', hero: false, className: 'calc-page' });
  page.body.classList.add('flush');
  page.body.appendChild(root);

  // ——— keys ———
  function press(k) {
    if (k === '=') return equals();
    if (k === 'deg') {
      deg = !deg;
      setPrefs({ deg });
      drawPad();
      return drawDisplay();
    }
    if (k === '2nd') {
      second = !second;
      return drawPad();
    }
    const r = M.press(state, k);
    if (r.msg) toast(t(r.msg));
    state = { expr: r.expr, done: r.done };
    drawDisplay();
  }

  function equals() {
    const r = M.equals(state.expr, { deg });
    if (!r) return;
    if (r.msg) return toast(t(r.msg));
    // "5 =" isn't a calculation: Samsung keeps History for real ones
    if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(r.expr)) {
      store.update('calc', (c) => ({ ...(c || {}), history: [{ expr: r.expr, result: r.result, time: Date.now() }, ...((c && c.history) || [])].slice(0, 60) }));
    }
    state = { expr: String(r.result), done: true };
    drawDisplay();
    if (showHistory) drawPad();
    display.classList.remove('pop');
    void display.offsetWidth;
    display.classList.add('pop');
  }

  const keyBtn = (k, label, kind, html) => h('button', {
    class: ['calc-key', kind],
    'data-k': k,
    'aria-label': label,
    // one inline box, so superscripts stay on the line of a grid-centred key
    html: html && `<span class="calc-lbl">${html}</span>`,
    onClick: () => press(k),
  }, html ? null : label);

  function drawPad() {
    const withSci = sci || wide;
    const keys = [];
    for (let r = 0; r < 5; r++) {
      if (withSci) {
        for (const [k1, k2] of SCI[r]) {
          const k = second && k2 ? k2 : k1;
          if (k === 'deg') keys.push(h('button', { class: 'calc-key sci mode', 'data-k': 'deg', title: t(deg ? 'calc.toRad' : 'calc.toDeg'), onClick: () => press('deg') }, deg ? 'Rad' : 'Deg'));
          else keys.push(keyBtn(k, SCI_NAME[k] || k, ['sci', k === '2nd' && second && 'on'].filter(Boolean).join(' '), SCI_HTML[k]));
        }
      }
      for (const [k, label = k, kind = ''] of MAIN.slice(r * 4, r * 4 + 4)) keys.push(keyBtn(k, label, kind));
    }
    pad.className = ['calc-pad', withSci && 'with-sci', showHistory && 'history'].filter(Boolean).join(' ');
    pad.replaceChildren(...keys, showHistory ? historyPane() : '');
  }

  function historyPane() {
    const hist = (store.get('calc') || {}).history || [];
    if (!hist.length) return h('div', { class: 'calc-hist' }, h('div', { class: 'ou-empty calc-hist-empty' }, h('span', { html: icon('history', 48) }), t('calc.noHistory')));
    return h('div', { class: 'calc-hist' },
      h('div', { class: 'calc-hist-list scroll' },
        hist.map((it) => h('div', { class: 'calc-hist-item' },
          h('button', { class: 'calc-hist-expr', dir: 'ltr', onClick: () => reuse(it.expr) }, M.display(it.expr)),
          h('button', { class: 'calc-hist-res', dir: 'ltr', onClick: () => insert(it.result) }, '=' + M.formatNumber(it.result))))),
      h('button', { class: 'ou-btn tonal calc-hist-clear', onClick: () => { store.update('calc', (c) => ({ ...(c || {}), history: [] })); drawPad(); } }, t('calc.clearHistory')));
  }
  // a calculation from History comes back to edit; its result goes in where the expression waits for a number
  function reuse(expr) {
    state = { expr: M.normalizeInput(expr), done: false };
    showHistory = false;
    drawAll();
  }
  function insert(n) {
    const s = String(n);
    state = !state.done && /[+\-*/^(]$/.test(state.expr) ? { expr: state.expr + (n < 0 && !/\($/.test(state.expr) ? '(' + s : s), done: false } : { expr: s, done: false };
    showHistory = false;
    drawAll();
  }

  // ——— display ———
  function drawDisplay() {
    mem = state;
    const txt = M.display(state.expr);
    exprEl.textContent = txt || '0';
    exprEl.classList.toggle('empty', !state.expr);
    exprEl.classList.toggle('result', state.done);
    const len = txt.length;
    exprEl.classList.toggle('small', len > 11 && len <= 18);
    exprEl.classList.toggle('xsmall', len > 18 && len <= 30);
    exprEl.classList.toggle('xxsmall', len > 30);
    previewEl.textContent = state.done ? '' : M.preview(state.expr, { deg });
    modeEl.hidden = deg;
    backBtn.disabled = !state.expr;
  }
  function drawTools() {
    histBtn.classList.toggle('active', showHistory);
    histBtn.innerHTML = icon(showHistory ? 'calc' : 'history', 24);
    histBtn.title = t(showHistory ? 'calc.keypad' : 'calc.history');
    histBtn.setAttribute('aria-label', histBtn.title);
    sciBtn.classList.toggle('active', sci || wide);
    sciBtn.hidden = wide;
  }
  function drawAll() {
    drawDisplay();
    drawTools();
    drawPad();
  }

  // ——— copy: long press or right-click on the display, or Ctrl+C ———
  const copyText = () => {
    if (state.done) return state.expr;
    const r = M.preview(state.expr, { deg }) ? M.evaluate(M.balance(state.expr), { deg }) : null;
    return r != null ? String(r) : M.display(state.expr);
  };
  const copyMenu = (e) => {
    e.preventDefault?.();
    if (!state.expr) return;
    menu(e, [{ label: t('calc.copy'), icon: 'copy', onClick: () => copy(copyText()) }]);
  };
  display.addEventListener('contextmenu', copyMenu);
  onLongPress(display, copyMenu);

  // ——— keyboard and paste ———
  // only the focused calculator window takes typing: another window (or Finder's box) may have the keyboard
  const mine = (e) => ctx.focused && ctx.depth === 1 && !e.target.closest?.('input,textarea,select,[contenteditable]');
  const flash = (k) => {
    const btn = pad.querySelector(`.calc-key[data-k="${CSS.escape(k)}"]`) || (k === 'back' ? backBtn : null);
    if (!btn) return;
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 120);
  };
  const onKey = (e) => {
    if (!ctx.focused) return;
    if (!mine(e) || e.altKey) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'c' && !getSelection().toString() && state.expr) {
        e.preventDefault();
        copy(copyText());
      }
      return;
    }
    const k = KEYMAP[e.key] ?? latinDigits(e.key);
    if (/^[0-9.+\-*/%!()^]$/.test(k) || k === '=' || k === 'back' || k === 'C') {
      e.preventDefault();
      press(k);
      flash(k === '(' || k === ')' ? '()' : k);
    }
  };
  const onPaste = (e) => {
    if (!ctx.focused) return;
    if (!mine(e)) return;
    const txt = M.normalizeInput(e.clipboardData?.getData('text') || '');
    if (!txt) return;
    e.preventDefault();
    if (!tokenize(txt)) return toast(t('calc.invalid'));
    state = { expr: (state.done ? '' : state.expr) + txt, done: false };
    drawDisplay();
  };
  addEventListener('keydown', onKey);
  addEventListener('paste', onPaste);
  // the side panel's calculator and other tabs write the same History
  const offHist = store.on('calc', () => { if (showHistory) drawPad(); });

  // Galaxy tablets in landscape always show the scientific keys
  const ro = new ResizeObserver(() => {
    const w = root.clientWidth >= 640 && root.clientHeight >= 420;
    if (w === wide) return;
    wide = w;
    root.classList.toggle('wide', wide);
    drawTools();
    drawPad();
  });
  ro.observe(root);

  // ——— Unit converter (and Tip calculator) as a sub-page with a back button ———
  let conv = null;
  function openConverter(section) {
    if (conv) return conv.show(section);
    ctx.push({
      title: t('calc.converter'),
      hero: false,
      className: 'calc-page calc-conv-page',
      render: (body) => import('./converter.js').then((m) => {
        conv = m.renderConverter(body, ctx, { section });
        return () => { conv.dispose(); conv = null; };
      }),
    });
  }

  const apply = (p) => {
    if (p?.expr != null) {
      state = { expr: M.normalizeInput(p.expr), done: false };
      showHistory = false;
      if (ctx.depth > 1) ctx.pop();
      drawAll();
    }
    if (p?.section === 'converter' || p?.section === 'tip') openConverter(p.section === 'tip' ? 'tip' : null);
  };
  ctx.setParams = apply;
  if (ctx.params?.expr != null) state = { expr: M.normalizeInput(ctx.params.expr), done: false };
  drawAll();
  if (ctx.params?.section) apply({ section: ctx.params.section });
  return () => {
    removeEventListener('keydown', onKey);
    removeEventListener('paste', onPaste);
    offHist();
    ro.disconnect();
  };
}

addStrings({
  en: {
    'calc.history': 'History',
    'calc.keypad': 'Keypad',
    'calc.clearHistory': 'Clear history',
    'calc.noHistory': 'No history',
    'calc.scientific': 'Scientific mode',
    'calc.backspace': 'Backspace',
    'calc.invalid': 'Invalid format used.',
    'calc.divZero': "Can't divide by 0.",
    'calc.maxDigits': "Can't enter more than 15 digits.",
    'calc.maxDecimals': "Can't enter more than 10 digits after the decimal point.",
    'calc.copy': 'Copy',
    'calc.copied': 'Copied to clipboard.',
    'calc.copyFailed': "Couldn't copy.",
    'calc.toRad': 'Switch to radians',
    'calc.toDeg': 'Switch to degrees',
  },
  ar: {
    'calc.history': 'السجل',
    'calc.keypad': 'لوحة المفاتيح',
    'calc.clearHistory': 'مسح السجل',
    'calc.noHistory': 'لا يوجد سجل',
    'calc.scientific': 'الوضع العلمي',
    'calc.backspace': 'حذف',
    'calc.invalid': 'تم استخدام تنسيق غير صالح.',
    'calc.divZero': 'لا يمكن القسمة على 0.',
    'calc.maxDigits': 'لا يمكن إدخال أكثر من 15 رقمًا.',
    'calc.maxDecimals': 'لا يمكن إدخال أكثر من 10 أرقام بعد الفاصلة العشرية.',
    'calc.copy': 'نسخ',
    'calc.copied': 'تم النسخ إلى الحافظة.',
    'calc.copyFailed': 'تعذّر النسخ.',
    'calc.toRad': 'التبديل إلى الراديان',
    'calc.toDeg': 'التبديل إلى الدرجات',
  },
});
