// Side panel › Calculator: Samsung Calculator's keypad (C, ( ), %, ÷, ×, −, +, +/−, =) with a live result under the
// expression, keyboard input, and the same history as the Calculator app (store key `calc`). The maths is the app's own
// evaluate() from js/apps/calculator.js.
import { h } from '../core/util.js';
import { store } from '../core/store.js';
import { t } from '../core/i18n.js';
import { toast } from '../core/ui.js';
import { evaluate, formatNumber } from '../apps/calculator.js';
import { header, openAppBtn, actionBtn, empty } from './kit.js';

const KEYS = [
  ['C', '()', '%', '/'],
  ['7', '8', '9', '*'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['+/-', '0', '.', '='],
];
const LABEL = { '/': '÷', '*': '×', '-': '−', '+/-': '+/−' };
const pretty = (s) => s.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
const BACKSPACE = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6.2-7L9 5Z"/><path d="m12 9.5 5 5M17 9.5l-5 5"/></svg>';

export function render(main) {
  let expr = '', justEvaluated = false, showHistory = false;
  const exprEl = h('div', { class: 'sp-calc-expr', dir: 'ltr' });
  const preview = h('div', { class: 'sp-calc-preview', dir: 'ltr' });
  const histBtn = actionBtn('history', t('sp.calc.history'), () => { showHistory = !showHistory; draw(); });
  const back = h('button', { class: 'ou-icon-btn sp-calc-back', title: t('sp.calc.backspace'), 'aria-label': t('sp.calc.backspace'), html: BACKSPACE, onClick: () => press('back') });
  const pad = h('div', { class: 'sp-calc-pad' });
  main.replaceChildren(
    header({ title: t('sp.tab.calc'), actions: [openAppBtn('calculator')] }),
    h('div', { class: 'sp-calc' }, h('div', { class: 'sp-calc-display' }, exprEl, preview), h('div', { class: 'sp-calc-tools' }, histBtn, h('span', { style: { flex: 1 } }), back), pad));

  const openParens = () => (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
  const endsWithOp = () => /[+\-*/^(]$/.test(expr);
  function press(k) {
    if (justEvaluated && /^[0-9.]$/.test(k)) expr = '';
    justEvaluated = false;
    switch (k) {
      case 'C': expr = ''; break;
      case 'back': expr = expr.slice(0, -1); break;
      case '()': expr += openParens() > 0 && /[0-9.)%]$/.test(expr) ? ')' : '('; break;
      case '+/-': {
        const m = /(\(-)?([0-9.]+)$/.exec(expr);
        if (!m) expr += '(-';
        else expr = expr.slice(0, m.index) + (m[1] ? m[2] : '(-' + m[2]);
        break;
      }
      case '.': {
        const num = /[0-9.]*$/.exec(expr)[0];
        if (!num.includes('.')) expr += num ? '.' : '0.';
        break;
      }
      case '+': case '-': case '*': case '/':
        if (!expr && k !== '-') expr = '0';
        if (/[+\-*/]$/.test(expr)) expr = expr.slice(0, -1);
        expr += k;
        break;
      case '%': if (expr && !endsWithOp()) expr += '%'; break;
      case '=': return equals();
      default:
        if (/^[0-9]$/.test(k)) {
          if (/(^|[^0-9.])0$/.test(expr)) expr = expr.slice(0, -1);
          expr += k;
        }
    }
    if (expr.length > 100) expr = expr.slice(0, 100);
    showHistory = false;
    draw();
  }
  function equals() {
    if (!expr) return;
    const r = evaluate(expr);
    if (r == null) return toast(t('sp.calc.invalid'));
    store.update('calc', (c) => ({ ...(c || {}), history: [{ expr, result: r, time: Date.now() }, ...((c && c.history) || [])].slice(0, 60) }));
    expr = String(r);
    justEvaluated = true;
    showHistory = false;
    draw();
  }

  function draw() {
    exprEl.textContent = pretty(expr) || '0';
    exprEl.classList.toggle('result', justEvaluated);
    exprEl.classList.toggle('long', expr.length > 14);
    const live = expr && !justEvaluated && /[+\-*/%(]/.test(expr.replace(/^\(-/, '')) ? evaluate(expr) : null;
    preview.textContent = live == null ? '' : formatNumber(live);
    histBtn.classList.toggle('active', showHistory);
    if (showHistory) {
      const hist = (store.get('calc')?.history) || [];
      pad.className = 'sp-calc-pad history';
      pad.replaceChildren(...(hist.length
        ? [h('div', { class: 'sp-calc-hist' }, hist.slice(0, 30).map((x) => h('button', { class: 'sp-calc-hrow', dir: 'ltr', onClick: () => { expr = String(x.result); justEvaluated = true; showHistory = false; draw(); } },
          h('span', null, pretty(x.expr)), h('b', null, '= ' + formatNumber(x.result))))),
        h('button', { class: 'ou-btn tonal sp-calc-clear', onClick: () => { store.update('calc', (c) => ({ ...(c || {}), history: [] })); draw(); } }, t('sp.calc.clearHistory'))]
        : [empty('history', t('sp.calc.noHistory'))]));
      return;
    }
    if (pad.classList.contains('history') || !pad.children.length) {
      pad.className = 'sp-calc-pad';
      pad.replaceChildren(...KEYS.flat().map((k) => h('button', {
        class: ['sp-key', /^[0-9.]$|^\+\/-$/.test(k) ? 'num' : k === '=' ? 'eq' : k === 'C' ? 'clear' : 'op'], dataset: { k }, onClick: () => press(k),
      }, LABEL[k] || k)));
    }
  }
  draw();

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, [contenteditable]')) return;
    const map = { Enter: '=', '=': '=', Backspace: 'back', Escape: 'C', Delete: 'C', x: '*', X: '*', '×': '*', '÷': '/', ',': '.' };
    const k = map[e.key] || (/^[0-9.+\-*/%]$/.test(e.key) ? e.key : e.key === '(' || e.key === ')' ? '()' : null);
    if (!k) return;
    e.preventDefault();
    press(k);
  };
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}
