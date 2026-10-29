// One UI building blocks: toast, popup menu, dialogs, switches, sliders, list rows.
import { h, clamp } from './util.js';
import { icon } from './icons.js';
import { t, isRtl } from './i18n.js';

const layer = () => document.getElementById('overlay-layer') || document.body;

// Escape closes only the top-most popup: a menu opened over a dialog closes alone, the dialog stays. Every menu
// and dialog listens on window (capture), so the one on top stops the event before the others see it.
const POPUPS = '.ou-menu-scrim, .ou-dialog-scrim';
const isTopPopup = (scrim) => [...document.querySelectorAll(POPUPS)].filter((s) => !s._closing).at(-1) === scrim;

// ——— toast ———
let toastEl, toastTimer;
export function toast(message, { action, onAction, duration = 2800 } = {}) {
  toastEl?.remove();
  clearTimeout(toastTimer);
  toastEl = h('div', { class: 'ou-toast', role: 'status' },
    h('span', null, message),
    action && h('button', { class: 'ou-toast-action', onClick: () => { onAction?.(); hide(); } }, action));
  layer().appendChild(toastEl);
  requestAnimationFrame(() => toastEl.classList.add('show'));
  const el = toastEl;
  const hide = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  };
  toastTimer = setTimeout(hide, duration);
}

// ——— popup menu ———
/**
 * menu(eventOrElementOrPoint, [{ label, icon, onClick, danger, checked, disabled } | '-'])
 */
export function menu(at, items, { align = 'start' } = {}) {
  closeMenus();
  const scrim = h('div', { class: 'ou-menu-scrim', onPointerdown: (e) => { if (e.target === scrim) close(); }, onContextmenu: (e) => { e.preventDefault(); close(); } });
  const box = h('div', { class: 'ou-menu', role: 'menu' });
  for (const it of items) {
    if (it === '-' || it === 'divider') {
      box.appendChild(h('div', { class: 'ou-menu-div' }));
      continue;
    }
    if (!it) continue;
    box.appendChild(
      h('button', {
        class: ['ou-menu-item', it.danger && 'danger'],
        role: 'menuitem',
        disabled: it.disabled,
        onClick: () => {
          close();
          it.onClick?.();
        },
      },
        it.icon ? h('span', { class: 'ou-menu-ico', html: icon(it.icon, 20) }) : null,
        h('span', { class: 'ou-menu-label' }, it.label),
        it.checked ? h('span', { class: 'ou-menu-check', html: icon('check', 18) }) : null)
    );
  }
  scrim.appendChild(box);
  layer().appendChild(scrim);

  // Like One UI, a menu opens towards the inside of the reading direction: right of the pointer in English, left of
  // it in Arabic (flipping only when it doesn't fit). Anchored to an element, `align` is logical too: 'start' lines
  // the menu up with the element's start edge (left in English, right in Arabic), 'end' with its end edge.
  const rtl = isRtl(), bw = box.offsetWidth, bh = box.offsetHeight;
  const point = !(at instanceof Element);
  let x, y, cx;
  if (!point) {
    const r = at.getBoundingClientRect();
    x = (align === 'end') !== rtl ? r.right - bw : r.left;
    y = r.bottom + 6;
  } else {
    cx = at && 'clientX' in at ? at.clientX : at?.x ?? innerWidth / 2;
    y = at && 'clientY' in at ? at.clientY : at?.y ?? innerHeight / 2;
    x = rtl ? cx - bw : cx;
    if (rtl && x < 8 && cx + bw <= innerWidth - 8) x = cx;
    else if (!rtl && x + bw > innerWidth - 8 && cx - bw >= 8) x = cx - bw;
  }
  x = clamp(x, 8, innerWidth - bw - 8);
  if (y + bh > innerHeight - 8) y = Math.max(8, y - bh - (!point ? at.getBoundingClientRect().height + 12 : 0));
  box.style.left = x + 'px';
  box.style.top = y + 'px';
  box.style.transformOrigin = point ? `${x < cx - 1 ? 'right' : 'left'} top` : 'top';
  requestAnimationFrame(() => box.classList.add('show'));
  const firstBtn = box.querySelector('button');
  firstBtn?.focus({ preventScroll: true });

  const onKey = (e) => {
    if (e.key === 'Escape' && isTopPopup(scrim)) {
      e.stopImmediatePropagation();
      close();
    }
  };
  addEventListener('keydown', onKey, true);
  function close() {
    removeEventListener('keydown', onKey, true);
    scrim._closing = true;
    box.classList.remove('show');
    scrim.classList.add('closing');
    setTimeout(() => scrim.remove(), 160);
  }
  scrim._close = close;
  return close;
}

export function closeMenus() {
  document.querySelectorAll('.ou-menu-scrim').forEach((s) => s._close?.());
}

// ——— dialog ———
/**
 * dialog({ title, message, content, actions: [{ label, value, primary, danger }] })
 * Resolves with the chosen action's value (or null when dismissed).
 */
export function dialog({ title, message, content, actions = [{ label: t('common.ok'), value: true, primary: true }], dismissable = true, className = '' } = {}) {
  return new Promise((resolve) => {
    const scrim = h('div', { class: 'ou-dialog-scrim' });
    const box = h('div', { class: ['ou-dialog', className], role: 'dialog', 'aria-modal': 'true' },
      title && h('div', { class: 'ou-dialog-title' }, title),
      message && h('div', { class: 'ou-dialog-msg' }, message),
      content || null,
      actions.length ? h('div', { class: 'ou-dialog-actions' },
        actions.map((a) => h('button', {
          class: ['ou-dialog-btn', a.primary && 'primary', a.danger && 'danger'],
          onClick: async () => {
            if (a.validate && !(await a.validate())) return;
            done(typeof a.value === 'function' ? a.value() : a.value);
          },
        }, a.label))) : null);
    scrim.appendChild(box);
    layer().appendChild(scrim);
    requestAnimationFrame(() => scrim.classList.add('show'));
    scrim.addEventListener('pointerdown', (e) => {
      if (e.target === scrim && dismissable) done(null);
    });
    const onKey = (e) => {
      if (!isTopPopup(scrim)) return; // a menu (or another dialog) is open on top of this one
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        if (dismissable) done(null);
      } else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
        const p = actions.find((a) => a.primary);
        if (p) {
          e.preventDefault();
          box.querySelector('.ou-dialog-btn.primary')?.click();
        }
      }
    };
    addEventListener('keydown', onKey, true);
    const auto = box.querySelector('input,textarea,select');
    setTimeout(() => auto?.focus(), 60);
    function done(v) {
      removeEventListener('keydown', onKey, true);
      scrim._closing = true;
      scrim.classList.remove('show');
      setTimeout(() => scrim.remove(), 220);
      resolve(v);
    }
    box._close = done;
  });
}

export const confirm = (title, message, { okLabel = t('common.ok'), danger = false } = {}) =>
  dialog({
    title,
    message,
    actions: [
      { label: t('common.cancel'), value: false },
      { label: okLabel, value: true, primary: !danger, danger },
    ],
  }).then(Boolean);

export function prompt(title, { value = '', placeholder = '', okLabel = t('common.save'), multiline = false, type = 'text' } = {}) {
  const input = multiline
    ? h('textarea', { class: 'ou-input', rows: 4, placeholder, value })
    : h('input', { class: 'ou-input', type, placeholder, value });
  return dialog({
    title,
    content: h('div', { class: 'ou-dialog-body' }, input),
    actions: [
      { label: t('common.cancel'), value: null },
      { label: okLabel, value: () => input.value, primary: true },
    ],
  });
}

/** Radio list dialog. options: [{ value, label, sub }] */
export function choose(title, options, current) {
  let picked = current;
  const box = h('div', { class: 'ou-radio-list' },
    options.map((o) => {
      const r = h('label', { class: 'ou-radio-row' },
        h('input', { type: 'radio', name: 'ou-choice', checked: o.value === current, onChange: () => (picked = o.value) }),
        h('span', { class: 'ou-radio' }),
        h('span', { class: 'ou-radio-text' }, h('span', null, o.label), o.sub && h('small', null, o.sub)));
      r.addEventListener('dblclick', () => box.closest('.ou-dialog')._close(o.value));
      return r;
    }));
  // only the list scrolls (class ou-choose): Cancel and Done stay in view however long it is, even at 800×600
  const res = dialog({
    title,
    content: box,
    className: 'ou-choose',
    actions: [
      { label: t('common.cancel'), value: null },
      { label: t('common.done'), value: () => picked, primary: true },
    ],
  });
  requestAnimationFrame(() => box.querySelector('input:checked')?.closest('.ou-radio-row')?.scrollIntoView({ block: 'nearest' }));
  return res;
}

// ——— controls ———
export function sw(checked, onChange, { label } = {}) {
  const input = h('input', { type: 'checkbox', checked: !!checked, 'aria-label': label || '', onChange: () => onChange?.(input.checked) });
  const el = h('label', { class: 'ou-switch', onClick: (e) => e.stopPropagation() }, input, h('span', { class: 'ou-switch-track' }, h('span', { class: 'ou-switch-thumb' })));
  el.set = (v) => (input.checked = !!v);
  el.input = input;
  return el;
}

export function seg(options, value, onChange) {
  const el = h('div', { class: 'ou-seg', role: 'tablist' });
  const render = () => {
    el.replaceChildren(
      ...options.map((o) =>
        h('button', {
          class: ['ou-seg-btn', o.value === value && 'active'],
          role: 'tab',
          'aria-selected': String(o.value === value),
          onClick: () => {
            value = o.value;
            render();
            onChange?.(o.value);
          },
        }, o.icon ? h('span', { html: icon(o.icon, 18) }) : null, o.label != null ? h('span', null, o.label) : null))
    );
  };
  render();
  el.set = (v) => {
    value = v;
    render();
  };
  return el;
}

/** One UI 9 thick slider with the icon living inside the fill. */
export function slider({ min = 0, max = 100, step = 1, value = 50, icon: ic, onInput, onChange, label = '' } = {}) {
  const fill = h('div', { class: 'ou-slider-fill' });
  const ico = ic ? h('span', { class: 'ou-slider-ico', html: icon(ic, 22) }) : null;
  const el = h('div', { class: 'ou-slider', role: 'slider', tabindex: 0, 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max }, fill, ico);
  const set = (v, fire) => {
    value = clamp(Math.round(v / step) * step, min, max);
    const pct = ((value - min) / (max - min)) * 100;
    fill.style.width = `max(var(--slider-h, 56px), ${pct}%)`;
    el.setAttribute('aria-valuenow', value);
    if (fire) onInput?.(value);
  };
  const fromEvent = (e) => {
    const r = el.getBoundingClientRect();
    let p = (e.clientX - r.left) / r.width;
    if (getComputedStyle(el).direction === 'rtl') p = 1 - p;
    return min + clamp(p, 0, 1) * (max - min);
  };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    set(fromEvent(e), true);
    const move = (ev) => set(fromEvent(ev), true);
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onChange?.(value);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('keydown', (e) => {
    const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }[e.key];
    if (d == null) return;
    e.preventDefault();
    set(value + d * (getComputedStyle(el).direction === 'rtl' && e.key.startsWith('Arrow') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') ? -1 : 1), true);
    onChange?.(value);
  });
  set(value);
  el.set = (v) => set(v);
  return el;
}

/**
 * Settings-style row.
 * row({ icon, iconBg, title, sub, right, chevron, onClick })
 */
export function row({ icon: ic, iconBg, title, sub, right, chevron, onClick, className } = {}) {
  const el = h(onClick ? 'button' : 'div', { class: ['ou-row', onClick && 'clickable', className], onClick },
    ic ? h('span', { class: 'ou-row-ico', style: iconBg ? { background: iconBg, color: '#fff' } : null, html: ic.startsWith('<') ? ic : icon(ic, 20) }) : null,
    h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, title), sub ? h('span', { class: 'ou-row-sub' }, sub) : null),
    right || null,
    chevron ? h('span', { class: 'ou-row-chev', html: icon('forward', 18) }) : null);
  return el;
}

/** Row with a switch on the right; clicking anywhere toggles. */
export function switchRow({ icon: ic, iconBg, title, sub, checked, onChange }) {
  const s = sw(checked, onChange, { label: title });
  const r = row({ icon: ic, iconBg, title, sub, right: s });
  r.classList.add('clickable');
  r.addEventListener('click', (e) => {
    if (e.target.closest('.ou-switch')) return;
    s.input.checked = !s.input.checked;
    onChange?.(s.input.checked);
  });
  return r;
}

export const card = (...children) => h('div', { class: 'ou-card' }, ...children);
export const list = (...rows) => h('div', { class: 'ou-card ou-list' }, ...rows);
export const subheader = (text) => h('div', { class: 'ou-subheader' }, text);
export const btn = (label, onClick, kind = '') => h('button', { class: ['ou-btn', kind], onClick }, label);
export const iconBtn = (name, onClick, title = '') => h('button', { class: 'ou-icon-btn', title, 'aria-label': title, onClick, html: icon(name, 22) });

/** Swatch row for picking a color. */
export function swatches(colors, value, onPick) {
  const el = h('div', { class: 'ou-swatches' });
  const render = () =>
    el.replaceChildren(
      ...colors.map((c) =>
        h('button', {
          class: ['ou-swatch', c === value && 'active'],
          style: { background: c === 'auto' ? 'conic-gradient(#ff6b6b,#ffd93d,#6bcB77,#4d96ff,#c77dff,#ff6b6b)' : c },
          title: c,
          onClick: () => {
            value = c;
            render();
            onPick(c);
          },
        })
      )
    );
  render();
  return el;
}
