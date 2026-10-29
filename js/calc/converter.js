// Samsung Calculator › Unit converter: Samsung's categories as tabs (Area, Length, Temperature, Volume, Mass, Data,
// Speed, Time) plus the Tip calculator, two unit fields with drop-down unit lists and a swap button, and the small
// converter keypad. Either field can be typed into; the other one follows. Long press (or right-click) a value to
// copy it. The unit tables are js/calc/units.js; the choices persist in store key `calcPrefs`.
import { h, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { addStrings, t, locale } from '../core/i18n.js';
import { toast, menu } from '../core/ui.js';
import * as M from './model.js';
import { formatNumber as fmtEngine, groupTyped, latinDigits } from './engine.js';
import { CATEGORIES, DEFAULTS, convert, unitName, unitSymbol, categoryName } from './units.js';
import { BACKSPACE, copy, setPrefs } from './ui.js';

export const CATS = [...CATEGORIES.filter((c) => !c.extra).map((c) => c.id), 'tip'];
const TIP_CHIPS = [10, 15, 18, 20];
// the value typed in each tab survives closing the converter in this tab
const mem = { value: '1', active: 0, bill: '', field: 0 };

const prefs = () => store.get('calcPrefs') || {};
const fmt = (v) => (Number.isFinite(v) ? fmtEngine(v, { digits: 12, loc: locale() }) : '—');
const money = (v) => new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
// a computed value becomes editable text when its field is tapped ("0.621371192237"), unless it needs an exponent
const editable = (v) => (Number.isFinite(v) && !/e/.test(String(+v.toPrecision(12))) ? String(+v.toPrecision(12)) : '');

export function renderConverter(body, ctx, { section } = {}) {
  let cat = section === 'tip' ? 'tip' : CATS.includes(prefs().convCat) ? prefs().convCat : 'length';
  const pairs = { ...DEFAULTS, ...(prefs().convPairs || {}) };
  const vals = [mem.value, ''];
  let active = mem.active;
  let tip = { bill: mem.bill, pct: String(prefs().tipPct ?? '15'), split: String(prefs().tipSplit ?? '1') };
  let field = mem.field;

  const tabs = h('div', { class: 'calc-cats', role: 'tablist' });
  const main = h('div', { class: 'calc-conv-main' });
  const pad = h('div', { class: 'calc-conv-pad', dir: 'ltr' });
  const root = h('div', { class: 'calc-conv' }, tabs, main, pad);
  body.classList.add('flush');
  body.appendChild(root);

  // ——— tabs ———
  function drawTabs() {
    tabs.replaceChildren(...CATS.map((c) => h('button', {
      class: ['calc-cat', c === cat && 'active'],
      role: 'tab',
      'aria-selected': String(c === cat),
      'data-cat': c,
      onClick: () => setCat(c),
    }, c === 'tip' ? t('calc.tip') : categoryName(c))));
    tabs.querySelector('.active')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }
  function setCat(c) {
    if (c === cat) return;
    cat = c;
    if (c !== 'tip') setPrefs({ convCat: c });
    drawTabs();
    drawMain();
    drawPad();
  }

  // ——— unit fields ———
  const units = () => pairs[cat] || DEFAULTS[cat];
  const number = (s) => {
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : 0;
  };
  const other = () => convert(number(vals[active]), units()[active], units()[1 - active]);

  function unitBtn(i) {
    const id = units()[i];
    const btn = h('button', { class: 'calc-unit', 'data-i': i, onClick: () => pickUnit(i, btn) },
      h('span', { class: 'calc-unit-name' }, unitName(id)),
      h('span', { class: 'calc-unit-sym', dir: 'ltr' }, unitSymbol(id)),
      h('span', { class: 'calc-unit-caret', html: icon('down', 18) }));
    return btn;
  }
  function pickUnit(i, btn) {
    const list = CATEGORIES.find((c) => c.id === cat).units;
    menu(btn, list.map((u) => ({
      label: `${unitName(u.id)} ${unitSymbol(u.id)}`,
      checked: u.id === units()[i],
      onClick: () => {
        const pair = [...units()];
        // picking the unit the other field shows swaps them, as Samsung's does
        if (pair[1 - i] === u.id) pair.reverse();
        else pair[i] = u.id;
        pairs[cat] = pair;
        setPrefs({ convPairs: { ...(prefs().convPairs || {}), [cat]: pair } });
        drawMain();
      },
    })));
    // long unit lists scroll inside the window instead of running off the screen
    const box = document.querySelector('.ou-menu-scrim:last-child .ou-menu');
    if (box) {
      box.classList.add('calc-unit-menu');
      box.style.maxHeight = Math.max(200, innerHeight - 24) + 'px';
      const top = Math.min(parseFloat(box.style.top) || 0, innerHeight - box.offsetHeight - 12);
      box.style.top = Math.max(12, top) + 'px';
      box.querySelector('.ou-menu-check')?.closest('button')?.scrollIntoView?.({ block: 'center' });
    }
  }
  function valueEl(text, on, i, onTap, copyValue) {
    const el = h('button', { class: ['calc-conv-value', on && 'active'], dir: 'ltr', 'data-i': i, onClick: onTap }, text);
    const copyMenu = (e) => {
      e.preventDefault?.();
      menu(e, [{ label: t('calc.copy'), icon: 'copy', onClick: () => copy(copyValue()) }]);
    };
    el.addEventListener('contextmenu', copyMenu);
    onLongPress(el, copyMenu);
    return el;
  }
  function setActive(i) {
    if (i === active) return;
    const v = other();
    vals[i] = editable(v);
    active = i;
    mem.active = i;
    mem.value = vals[i];
    drawMain();
  }

  function drawMain() {
    if (cat === 'tip') return drawTip();
    const res = other();
    const text = (i) => (i === active ? groupTyped(vals[i] || '0', locale()) : fmt(res));
    const fieldEl = (i) => h('div', { class: ['calc-field', i === active && 'active'] },
      unitBtn(i),
      valueEl(text(i), i === active, i, () => setActive(i), () => (i === active ? vals[i] || '0' : String(+res.toPrecision(12)))));
    main.className = 'calc-conv-main';
    main.replaceChildren(
      fieldEl(0),
      h('div', { class: 'calc-swap-row' }, h('button', {
        class: 'ou-icon-btn calc-swap',
        title: t('calc.swap'),
        'aria-label': t('calc.swap'),
        html: icon('calcSwap', 22),
        onClick: () => {
          pairs[cat] = [...units()].reverse();
          setPrefs({ convPairs: { ...(prefs().convPairs || {}), [cat]: pairs[cat] } });
          drawMain();
        },
      })),
      fieldEl(1));
  }

  // ——— Tip calculator ———
  const TIP_FIELDS = ['bill', 'pct', 'split'];
  function drawTip() {
    const r = M.tipSplit(number(tip.bill), number(tip.pct), number(tip.split));
    const row = (i, label, suffix) => {
      const k = TIP_FIELDS[i];
      return h('div', { class: ['calc-field', 'calc-tip-field', i === field && 'active'] },
        h('div', { class: 'calc-tip-label' }, label),
        valueEl(groupTyped(tip[k] || '0', locale()) + (suffix || ''), i === field, i, () => { field = i; mem.field = i; drawMain(); drawPad(); }, () => tip[k] || '0'));
    };
    const out = (label, v, cls) => h('div', { class: ['calc-tip-out', cls] }, h('span', null, label), h('b', { dir: 'ltr' }, money(v)));
    main.className = 'calc-conv-main tip';
    main.replaceChildren(
      row(0, t('calc.tip.bill')),
      row(1, t('calc.tip.pct'), '%'),
      h('div', { class: 'ou-chips calc-tip-chips' }, TIP_CHIPS.map((p) => h('button', {
        class: ['ou-chip', String(p) === tip.pct && 'active'],
        dir: 'ltr',
        onClick: () => { tip.pct = String(p); setPrefs({ tipPct: tip.pct }); drawMain(); },
      }, p + '%'))),
      row(2, t('calc.tip.split')),
      h('div', { class: 'calc-tip-result' },
        out(t('calc.tip.tip'), r.tip),
        out(t('calc.tip.total'), r.total),
        out(t('calc.tip.each'), r.each, 'each')));
  }

  // ——— keypad: digits on the left, ⌫ and C as tall keys on the right ———
  const KEYS = [['7'], ['8'], ['9'], ['back', '', 'act tall back'], ['4'], ['5'], ['6'], ['1'], ['2'], ['3'], ['C', 'C', 'act tall clear'], ['+/-', '+/−'], ['0'], ['.']];
  function drawPad() {
    const signOk = cat === 'temperature';
    const dotOk = !(cat === 'tip' && field === 2);
    pad.replaceChildren(...KEYS.map(([k, label = k, kind = '']) => h('button', {
      class: ['calc-key', kind],
      'data-k': k,
      'aria-label': k === 'back' ? t('calc.backspace') : label,
      disabled: (k === '+/-' && !signOk) || (k === '.' && !dotOk),
      html: k === 'back' ? BACKSPACE : null,
      onClick: () => key(k),
    }, k === 'back' ? null : label)));
  }
  function key(k) {
    if (cat === 'tip') {
      const f = TIP_FIELDS[field];
      if (k === '+/-' || (k === '.' && f === 'split')) return;
      let r = M.editValue(tip[f], k);
      if (f !== 'bill' && r.value.replace(/\D/g, '').length > 3) r = { value: tip[f] }; // 999 % and 999 people at most
      if (r.msg) toast(t(r.msg));
      tip[f] = r.value;
      if (f === 'bill') mem.bill = r.value;
      else setPrefs({ [f === 'pct' ? 'tipPct' : 'tipSplit']: r.value });
      return drawMain();
    }
    if (k === '+/-' && cat !== 'temperature') return;
    const r = M.editValue(vals[active], k);
    if (r.msg) toast(t(r.msg));
    vals[active] = r.value;
    mem.value = r.value;
    drawMain();
  }

  // ——— keyboard ———
  const onKey = (e) => {
    if (!ctx.focused) return;
    if (ctx.depth < 2 || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select,[contenteditable]')) return;
    const n = cat === 'tip' ? 3 : 2;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = ((cat === 'tip' ? field : active) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      if (cat === 'tip') {
        field = next;
        mem.field = next;
        drawMain();
        drawPad();
      } else setActive(next);
      return;
    }
    const k = { Backspace: 'back', Delete: 'C', '-': '+/-', '٫': '.', ',': '.' }[e.key] ?? latinDigits(e.key);
    if (/^[0-9.]$/.test(k) || k === 'back' || k === 'C' || k === '+/-') {
      e.preventDefault();
      key(k);
      const btn = pad.querySelector(`.calc-key[data-k="${CSS.escape(k)}"]`);
      btn?.classList.add('pressed');
      setTimeout(() => btn?.classList.remove('pressed'), 120);
    }
  };
  addEventListener('keydown', onKey);

  drawTabs();
  drawMain();
  drawPad();
  return {
    show(section) {
      if (section === 'tip') setCat('tip');
    },
    dispose() {
      removeEventListener('keydown', onKey);
    },
  };
}

addStrings({
  en: {
    'calc.swap': 'Swap units',
    'calc.tip': 'Tip',
    'calc.tip.bill': 'Bill',
    'calc.tip.pct': 'Tip',
    'calc.tip.split': 'Split between',
    'calc.tip.tip': 'Tip amount',
    'calc.tip.total': 'Total',
    'calc.tip.each': 'Per person',
  },
  ar: {
    'calc.swap': 'تبديل الوحدات',
    'calc.tip': 'البقشيش',
    'calc.tip.bill': 'الفاتورة',
    'calc.tip.pct': 'البقشيش',
    'calc.tip.split': 'التقسيم على',
    'calc.tip.tip': 'مبلغ البقشيش',
    'calc.tip.total': 'الإجمالي',
    'calc.tip.each': 'لكل شخص',
  },
});
