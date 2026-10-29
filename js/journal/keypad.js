// The One UI PIN screen for Lock Journal: a lock badge, the title, dots for the digits typed, an error line and a
// big numeric keypad (keyboard digits, Backspace and Enter work too). Used for unlocking the Journal and for setting,
// changing and turning off its PIN.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { MIN, MAX } from './pin.js';

/**
 * pinView({ title, sub, digits, okLabel, onSubmit(pin) → true | 'error text' | { wait }, onCancel, onForgot })
 * digits > 0: the PIN is checked as soon as that many digits are typed (One UI's auto-confirm); 0: an OK button.
 * → { el, reset(title, sub), setError(msg) }
 */
export function pinView({ title, sub = '', digits = 0, okLabel = t('journal.pinContinue'), onSubmit, onCancel, onForgot } = {}) {
  let pin = '', busy = false, waitTimer = null;
  const titleEl = h('h2', { class: 'jr-pin-title' }, title);
  const subEl = h('p', { class: 'jr-pin-sub' }, sub);
  const dots = h('div', { class: 'jr-pin-dots', 'aria-hidden': 'true' });
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const err = h('p', { class: 'jr-pin-err', role: 'alert' });
  const ok = digits ? null : h('button', { class: 'jr-pin-key jr-pin-ok', disabled: true, onClick: () => submit() }, okLabel);
  const key = (d) => h('button', { class: 'jr-pin-key', 'aria-label': d, onClick: () => press(d) }, h('b', null, d));
  const pad = h('div', { class: 'jr-pad', role: 'group', 'aria-label': t('journal.pinKeypad') },
    ...'123456789'.split('').map(key),
    // One UI's bottom row: Delete, 0, OK
    h('button', { class: 'jr-pin-key jr-pin-del', 'aria-label': t('journal.pinDelete'), title: t('journal.pinDelete'), html: icon('jr-backspace', 26), onClick: () => back() }),
    key('0'),
    ok || h('span'));
  const el = h('div', { class: 'jr-pin' },
    h('div', { class: 'jr-pin-top' }, h('span', { class: 'jr-pin-badge', html: icon('lock', 26) }), titleEl, subEl, dots, err, live),
    pad,
    onForgot || onCancel ? h('div', { class: 'jr-pin-foot' },
      onForgot ? h('button', { class: 'ou-btn jr-pin-forgot', onClick: () => onForgot() }, t('journal.pinForgot')) : null,
      onCancel ? h('button', { class: 'ou-btn', onClick: () => onCancel() }, t('common.cancel')) : null) : null);

  const drawDots = () => {
    const n = digits || Math.max(MIN, pin.length);
    dots.replaceChildren(...Array.from({ length: n }, (_, i) => h('i', { class: i < pin.length && 'on' })));
    live.textContent = pin.length ? t('journal.pinTyped', { n: pin.length }) : '';
    if (ok) ok.disabled = pin.length < MIN || busy;
  };
  function press(d) {
    if (busy || waitTimer || pin.length >= (digits || MAX)) return;
    pin += d;
    err.textContent = '';
    el.classList.remove('shake');
    drawDots();
    if (digits && pin.length === digits) setTimeout(submit, 90);
  }
  function back() {
    if (busy) return;
    pin = pin.slice(0, -1);
    drawDots();
  }
  async function submit() {
    if (busy || pin.length < MIN) return;
    busy = true;
    drawDots();
    const res = await onSubmit?.(pin);
    busy = false;
    if (res === true || !el.isConnected) return;
    pin = '';
    drawDots();
    if (res && typeof res === 'object' && res.wait) wait(res.wait);
    else setError(res || t('journal.pinWrong'));
  }
  function wait(sec) {
    clearInterval(waitTimer);
    let left = sec;
    el.classList.add('waiting');
    const tick = () => {
      if (left <= 0 || !el.isConnected) {
        clearInterval(waitTimer);
        waitTimer = null;
        el.classList.remove('waiting');
        err.textContent = '';
        return;
      }
      err.textContent = t('journal.pinWait', { n: left-- });
    };
    tick();
    waitTimer = setInterval(tick, 1000);
  }
  function setError(msg) {
    err.textContent = msg;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }
  // keyboard: digits, Backspace, Enter (not while a dialog or menu is on top)
  const onKey = (e) => {
    if (!el.isConnected) return removeEventListener('keydown', onKey, true);
    if (document.querySelector('.ou-dialog-scrim, .ou-menu-scrim') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!el.offsetParent) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') back();
    else if (e.key === 'Enter' && !digits) submit();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  addEventListener('keydown', onKey, true);
  drawDots();
  return {
    el,
    reset(nt, ns) {
      pin = '';
      if (nt != null) titleEl.textContent = nt;
      if (ns != null) subEl.textContent = ns;
      err.textContent = '';
      drawDots();
    },
    setError,
    wait,
    destroy: () => {
      removeEventListener('keydown', onKey, true);
      clearInterval(waitTimer);
    },
  };
}

/**
 * Set a new PIN on a pushed page: enter it, then confirm it. Resolves the PIN, or null when backed out.
 */
export function setPinFlow(ctx, { title = t('journal.pinSet') } = {}) {
  return new Promise((resolve) => {
    let first = null, done = false;
    ctx.push({
      title,
      hero: false,
      className: 'jr-pin-page',
      render(body) {
        const v = pinView({
          title: t('journal.pinNew'),
          sub: t('journal.pinRule'),
          okLabel: t('journal.pinContinue'),
          onSubmit: async (pin) => {
            if (!first) {
              first = pin;
              v.reset(t('journal.pinConfirm'), t('journal.pinConfirmSub'));
              return true;
            }
            if (pin !== first) {
              first = null;
              v.reset(t('journal.pinNew'), t('journal.pinRule'));
              return t('journal.pinMismatch');
            }
            done = true;
            resolve(pin);
            ctx.pop();
            return true;
          },
        });
        body.append(v.el);
        return () => {
          v.destroy();
          if (!done) resolve(null);
        };
      },
    });
  });
}

/** Ask for the current PIN on a pushed page (to change it or turn the lock off). Resolves true when it matched. */
export function verifyFlow(ctx, { title, verify, digits = 0 }) {
  return new Promise((resolve) => {
    let done = false;
    ctx.push({
      title,
      hero: false,
      className: 'jr-pin-page',
      render(body) {
        const v = pinView({
          title: t('journal.pinEnter'),
          sub: '',
          digits,
          onSubmit: async (pin) => {
            const r = await verify(pin);
            if (!r.ok) return r.wait ? { wait: r.wait } : t('journal.pinWrong');
            done = true;
            resolve(true);
            ctx.pop();
            return true;
          },
        });
        body.append(v.el);
        return () => {
          v.destroy();
          if (!done) resolve(false);
        };
      },
    });
  });
}
