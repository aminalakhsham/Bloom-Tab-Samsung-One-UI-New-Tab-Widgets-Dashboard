// Screen lock PIN (Settings › Lock screen › Screen lock type › PIN), the One UI way: a 4–16 digit PIN on Samsung's
// keypad guards the Lock screen and everything behind it (apps, Finder, notification deep links). Only a salted
// PBKDF2-SHA-256 hash is kept, in store key `pin` on this computer; wrong tries in a row are counted in `pinTries`.
// Neither is ever exported (Settings › Backup drops them) or synced. After 5 wrong PINs the keypad waits 30 seconds,
// and longer and longer after that (Android's Gatekeeper table, which Galaxy phones use). "Forgot PIN?" can only erase
// Bloom Tab on this computer: there is no account to recover the PIN with.
//
//   pinSet(), pinRec(), autoConfirm(), setPin(pin, { auto }), removePin(), setAuto(on)
//   tryPin(pin) → { ok } | { ok: false, n (wrong tries in a row), wait (ms) }    waitLeft(), waitText(ms)
//   keypad({ mode: 'lock' | 'page', … }) → the keypad UI (the Lock screen's bouncer and the Settings pages)
//   setPinFlow(ctx), verifyFlow(ctx, opts) → pushed Settings pages ("Set PIN", "Confirm PIN")
//   forgotPin() → the erase dialog;  eraseEverything() → store, pictures/recordings (IndexedDB), alarms, session
import { h, isExt } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t, addStrings, locale } from '../core/i18n.js';
import { store, setting } from '../core/store.js';
import { dialog } from '../core/ui.js';

export const MIN = 4, MAX = 16, ITER = 150000, TRIES = 5;
export const KEY = 'pin', TRIES_KEY = 'pinTries';
/** "Lock automatically" (Settings › Lock screen › Secure lock settings): minutes after the last use before a new tab
 *  or a tab you come back to asks for the PIN again. 0 = every time. */
export const AFTER = [0, 1, 5, 10, 15, 30, 60];
export const lockAfter = () => { const v = setting('lockAfter'); return AFTER.includes(v) ? v : 5; };

addIcons({
  pinBackspace: '<path d="M9 5.5h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5.5-6.5L9 5.5Z"/><path d="m11.5 9.5 5 5M16.5 9.5l-5 5"/>',
});

// ——— the record ———
export function pinRec() {
  const v = store.get(KEY);
  return v && typeof v === 'object' && v.hash && v.salt ? v : null;
}
export const pinSet = () => !!pinRec();
export const pinDigits = () => pinRec()?.digits || 0;
/** "Confirm PIN without tapping OK": the keypad unlocks as soon as the last digit is in. One UI offers it for PINs of
 *  6 digits or more (a shorter one would be too easy to find by trying lengths). */
export const autoConfirm = () => { const r = pinRec(); return !!r && r.digits >= 6 && r.auto !== false; };
export const validPin = (pin) => new RegExp(`^\\d{${MIN},${MAX}}$`).test(String(pin ?? ''));

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(pin, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}

/** Sets (or changes) the PIN and clears the wrong-try count. */
export async function setPin(pin, { auto } = {}) {
  if (!validPin(pin)) throw new Error(`PIN must be ${MIN} to ${MAX} digits`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = b64(await derive(pin, salt, ITER));
  const digits = String(pin).length;
  store.set(KEY, { alg: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), hash, digits, auto: auto ?? digits >= 6, at: Date.now() });
  store.set(TRIES_KEY, { n: 0, until: 0 });
}
export function removePin() {
  store.remove(KEY);
  store.remove(TRIES_KEY);
}
export function setAuto(on) {
  const r = pinRec();
  if (r) store.set(KEY, { ...r, auto: !!on });
}

/** True when `pin` is the PIN (compared in constant time). Doesn't count tries: use tryPin() for anything a user types. */
export async function checkPin(pin) {
  const r = pinRec();
  if (!r || !validPin(pin)) return false;
  const a = new Uint8Array(await derive(pin, unb64(r.salt), r.iter || ITER)), b = unb64(r.hash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ——— wrong tries ———
/** How long the keypad waits after the n-th wrong PIN in a row (Android Gatekeeper, as on Galaxy phones): 30 s after
 *  the 5th and the 10th, after every one from the 11th, doubling every 10 more from the 30th, at most a day. */
export function waitAfter(n) {
  if (n < TRIES) return 0;
  if (n <= 10) return n % TRIES === 0 ? 30e3 : 0;
  if (n < 30) return 30e3;
  if (n < 140) return Math.min(864e5, 30e3 * 2 ** Math.floor((n - 30) / 10));
  return 864e5;
}
export function tries() {
  const v = store.get(TRIES_KEY);
  return { n: Math.max(0, +v?.n || 0), until: Math.max(0, +v?.until || 0) };
}
/** Milliseconds the keypad still waits (0 = may type). */
export const waitLeft = (now = Date.now()) => Math.max(0, tries().until - now);

/** Checks a typed PIN and counts the wrong ones. → { ok: true } or { ok: false, n, wait } (wait in ms). */
export async function tryPin(pin) {
  if (!pinSet()) return { ok: true };
  if (waitLeft()) return { ok: false, n: tries().n, wait: waitLeft() };
  if (await checkPin(pin)) {
    const tr = tries();
    if (tr.n || tr.until) store.set(TRIES_KEY, { n: 0, until: 0 });
    return { ok: true };
  }
  const n = tries().n + 1, wait = waitAfter(n);
  store.set(TRIES_KEY, { n, until: wait ? Date.now() + wait : 0 });
  return { ok: false, n, wait };
}

/** "Try again in 30 seconds" / "… in 2 minutes" / "… in 1 hour". */
export function waitText(ms = waitLeft()) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  let n = s, unit = 'second';
  if (s > 90 * 60) { n = Math.ceil(s / 3600); unit = 'hour'; } else if (s > 90) { n = Math.ceil(s / 60); unit = 'minute'; }
  let when;
  try {
    when = new Intl.NumberFormat(locale(), { style: 'unit', unit, unitDisplay: 'long' }).format(n);
  } catch {
    when = `${n} ${unit}s`;
  }
  return t('pin.tryIn', { when: `⁨${when}⁩` });
}

// ——— erase (Forgot PIN?) ———
/** Erases Bloom Tab on this computer: chrome.storage (with the PIN), pictures, recordings and songs (IndexedDB),
 *  alarms and the session. The caller reloads the page. */
export async function eraseEverything() {
  // chrome.storage goes last: clearing it changes the language setting, which reloads every open page at once
  await import('../core/blobs.js').then((m) => m.eraseBlobs()).catch(() => {});
  await Promise.resolve(indexedDB.databases?.()).then((dbs) => Promise.all((dbs || []).map((d) => new Promise((r) => {
    const q = indexedDB.deleteDatabase(d.name);
    q.onsuccess = q.onerror = q.onblocked = r;
  })))).catch(() => {});
  if (isExt) await Promise.all([chrome.alarms.clearAll(), chrome.storage.session?.clear()]).catch(() => {});
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('bt')).forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch {}
  await store.importAll({});
}

/** "Forgot PIN?": the only way back in without the PIN is to erase Bloom Tab. Resolves false when cancelled. */
export async function forgotPin() {
  const ok = await dialog({
    title: t('pin.eraseTitle'),
    message: t('pin.eraseMsg'),
    className: 'pin-erase',
    actions: [{ label: t('common.cancel'), value: false }, { label: t('pin.erase'), value: true, danger: true }],
  });
  if (!ok) return false;
  await eraseEverything();
  location.reload();
  return true;
}

// ——— the keypad ———
const LETTERS = ['', '', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ'];
// Arabic-Indic and Persian digits typed on an Arabic keyboard count as the same PIN digits
const latin = (k) => String(k).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);

/**
 * Samsung's PIN keypad: the title, a line for hints and errors, dots that fill, round keys with letters under the
 * digits and a bottom row of Delete, 0 and OK.
 *   mode 'lock': white on the dimmed wallpaper (the Lock screen); 'page': inside an app page (Settings) or the side
 *   panel (badge: true adds the padlock over the title there).
 *   len > 0: the PIN is checked as soon as that many digits are in ("Confirm PIN without tapping OK"), no OK key.
 *   onSubmit(pin) → true (keep going) | 'error text' | { wait: ms }   onCancel(), onForgot() add the footer links.
 * → { el, key(e) → bool, press(k), clear(), setTitle(title, sub), setLen(n), error(msg), wait(ms), destroy() }
 */
export function keypad({ mode = 'page', title = '', sub = '', len = 0, okLabel = t('common.ok'), badge = mode === 'lock', onSubmit, onCancel, onForgot, onInput } = {}) {
  let code = '', busy = false, waitTimer = 0, gone = false, hint = sub;
  const titleEl = h('div', { class: 'pin-title' }, title);
  const subEl = h('div', { class: 'pin-sub', role: 'status' }, sub);
  const dots = h('div', { class: 'pin-dots', 'aria-hidden': 'true' });
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const key = (n) => h('button', { type: 'button', class: 'pin-key', dataset: { k: String(n) }, 'aria-label': String(n) }, h('b', null, String(n)), h('small', null, LETTERS[n]));
  const del = h('button', { type: 'button', class: 'pin-key pin-fn pin-del', dataset: { k: 'del' }, 'aria-label': t('pin.delete'), title: t('pin.delete'), html: icon('pinBackspace', 28) });
  const ok = h('button', { type: 'button', class: 'pin-key pin-fn pin-ok', dataset: { k: 'ok' } }, okLabel);
  const pad = h('div', { class: 'pin-pad', dir: 'ltr', role: 'group', 'aria-label': t('pin.keypad') }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(key), del, key(0), ok);
  const foot = onForgot || onCancel ? h('div', { class: 'pin-foot' },
    onForgot ? h('button', { type: 'button', class: 'pin-link pin-forgot', onClick: () => onForgot() }, t('pin.forgot')) : h('span'),
    onCancel ? h('button', { type: 'button', class: 'pin-link pin-cancel', onClick: () => onCancel() }, t('common.cancel')) : null) : null;
  const el = h('div', { class: ['pin', 'pin-' + mode], tabindex: -1, role: 'group', 'aria-label': title },
    h('div', { class: 'pin-top' }, badge ? h('span', { class: 'pin-badge', html: icon('lock', 22) }) : null, titleEl, subEl, dots, live),
    pad, foot);

  const draw = () => {
    const n = len || code.length;
    dots.classList.toggle('fixed', !!len);
    dots.replaceChildren(...Array.from({ length: n }, (_, i) => h('i', { class: i < code.length ? 'on' : '' })));
    live.textContent = code.length ? t('pin.typed', { n: code.length }) : '';
    ok.hidden = !!len;
    ok.disabled = busy || code.length < MIN;
    del.disabled = busy || !code.length;
  };
  const setSub = (text, kind = '') => {
    subEl.textContent = text;
    subEl.className = 'pin-sub' + (kind ? ' ' + kind : '');
  };
  async function submit() {
    if (busy || waitTimer || code.length < MIN) return;
    busy = true;
    draw();
    const res = await onSubmit?.(code);
    busy = false;
    if (gone) return;
    if (res === true) {
      code = '';
      draw();
      return;
    }
    code = '';
    draw();
    if (res && typeof res === 'object' && res.wait) api.wait(res.wait);
    else api.error(typeof res === 'string' ? res : t('pin.wrong'));
  }
  function press(k) {
    if (gone) return;
    onInput?.();
    if (busy || waitTimer) return;
    if (k === 'del') {
      code = code.slice(0, -1);
      draw();
      return;
    }
    if (k === 'ok') return submit();
    if (!/^\d$/.test(k) || code.length >= (len || MAX)) return;
    code += k;
    el.classList.remove('shake');
    if (subEl.classList.contains('err')) setSub(hint);
    draw();
    // the last dot fills before the answer comes
    if (len && code.length === len) setTimeout(submit, 90);
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (b && !b.disabled) press(b.dataset.k);
  });
  // a key lights up while it is held (and quick taps never select text)
  el.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    e.preventDefault();
    b.classList.add('down');
    const up = () => b.classList.remove('down');
    addEventListener('pointerup', up, { once: true });
    addEventListener('pointercancel', up, { once: true });
  });
  const flash = (k) => {
    const b = pad.querySelector(`[data-k="${k}"]`);
    if (!b) return;
    b.classList.add('down');
    setTimeout(() => b.classList.remove('down'), 130);
  };
  const api = {
    el,
    press,
    /** A keydown from the page; true when the keypad used it. */
    key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      const k = latin(e.key);
      if (/^\d$/.test(k)) { flash(k); press(k); return true; }
      if (e.key === 'Backspace' || e.key === 'Delete') { flash('del'); press('del'); return true; }
      if (e.key === 'Enter') { flash('ok'); press('ok'); return true; }
      return false;
    },
    clear() {
      code = '';
      draw();
    },
    setTitle(text, subText = '') {
      titleEl.textContent = text;
      el.setAttribute('aria-label', text);
      hint = subText;
      if (!waitTimer) setSub(subText);
    },
    setLen(n) {
      len = n || 0;
      draw();
    },
    error(msg) {
      setSub(msg, 'err');
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      navigator.vibrate?.(60);
    },
    /** Greys out the keys and counts down "Try again in 30 seconds". */
    wait(ms) {
      clearInterval(waitTimer);
      const until = Date.now() + ms;
      el.classList.add('out');
      const tick = () => {
        // the stored lockout wins (another tab, or a PIN entered elsewhere, may have changed it)
        const left = Math.min(until - Date.now(), pinSet() ? waitLeft() : Infinity);
        if (left <= 0 || gone) {
          clearInterval(waitTimer);
          waitTimer = 0;
          el.classList.remove('out');
          setSub(hint);
          draw();
          return;
        }
        setSub(`${t('pin.tooMany')} ${waitText(left)}`, 'wait');
      };
      waitTimer = setInterval(tick, 1000);
      tick();
    },
    destroy() {
      gone = true;
      clearInterval(waitTimer);
    },
  };
  draw();
  if (waitLeft() && mode === 'lock') api.wait(waitLeft());
  return api;
}

// ——— Settings pages ———
/** Shows a keypad as a pushed page of the Settings app. step(pad, done) wires it up; resolves with done(value) or
 *  null when the page is left (Back). */
function pinPage(ctx, title, step) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
      ctx.pop();
    };
    ctx.push({
      title,
      hero: false,
      className: 'pin-page-wrap',
      render(body) {
        const pad = step(done);
        body.append(pad.el);
        const win = ctx.win;
        const onKey = (e) => {
          if (settled || document.querySelector('.ou-dialog-scrim') || !pad.el.isConnected) return;
          if (pad.key(e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        };
        win.addEventListener('keydown', onKey);
        setTimeout(() => pad.el.focus({ preventScroll: true }), 60);
        if (waitLeft() && pad.checks) pad.wait(waitLeft());
        return () => {
          win.removeEventListener('keydown', onKey);
          pad.destroy();
          if (!settled) {
            settled = true;
            resolve(null);
          }
        };
      },
    });
  });
}

/** "Set PIN" then "Confirm PIN", like One UI. Resolves with the new PIN, or null when left. */
export function setPinFlow(ctx, { title = t('pin.set') } = {}) {
  return pinPage(ctx, title, (done) => {
    let first = '';
    const pad = keypad({
      mode: 'page',
      title: t('pin.setTitle'),
      sub: t('pin.rule', { min: MIN, max: MAX }),
      okLabel: t('pin.continue'),
      onSubmit: async (pin) => {
        if (!first) {
          first = pin;
          pad.setTitle(t('pin.confirm'), t('pin.confirmSub'));
          pad.el.querySelector('.pin-ok').textContent = t('common.ok');
          return true;
        }
        if (pin !== first) {
          first = '';
          pad.setTitle(t('pin.setTitle'), t('pin.rule', { min: MIN, max: MAX }));
          pad.el.querySelector('.pin-ok').textContent = t('pin.continue');
          return t('pin.mismatch');
        }
        done(pin);
        return true;
      },
    });
    return pad;
  });
}

/** "Confirm PIN": asks for the current PIN (wrong tries count and lock out like on the Lock screen). Resolves true. */
export function verifyFlow(ctx, { title = t('pin.confirm'), sub = t('pin.verifySub') } = {}) {
  if (!pinSet()) return Promise.resolve(true);
  return pinPage(ctx, title, (done) => {
    const pad = keypad({
      mode: 'page',
      title: t('pin.enter'),
      sub,
      len: autoConfirm() ? pinDigits() : 0,
      onSubmit: async (pin) => {
        const r = await tryPin(pin);
        if (r.ok) {
          done(true);
          return true;
        }
        return r.wait ? { wait: r.wait } : wrongText(r.n);
      },
    });
    pad.checks = true;
    return pad;
  }).then(Boolean);
}

/** "Incorrect PIN", plus how many tries are left before the keypad waits. */
export function wrongText(n) {
  const left = TRIES - (n % TRIES);
  return n >= 2 && n < 10 && left < TRIES ? `${t('pin.wrong')} · ${t(left === 1 ? 'pin.left1' : 'pin.leftN', { n: left })}` : t('pin.wrong');
}

addStrings({
  en: {
    'pin.pin': 'PIN',
    'pin.enter': 'Enter PIN',
    'pin.set': 'Set PIN',
    'pin.setTitle': 'Set a PIN',
    'pin.rule': 'PIN must contain {min} to {max} digits.',
    'pin.continue': 'Continue',
    'pin.confirm': 'Confirm PIN',
    'pin.confirmSub': 'Enter the same PIN again.',
    'pin.verifySub': 'Enter your current PIN to continue.',
    'pin.mismatch': 'PINs don’t match. Try again.',
    'pin.wrong': 'Incorrect PIN',
    'pin.left1': '1 more try before a wait',
    'pin.leftN': '{n} more tries before a wait',
    'pin.tooMany': 'Too many incorrect attempts.',
    'pin.tryIn': 'Try again in {when}.',
    'pin.forgot': 'Forgot PIN?',
    'pin.delete': 'Delete',
    'pin.keypad': 'Keypad',
    'pin.typed': '{n} digits entered',
    'pin.eraseTitle': 'Erase Bloom Tab?',
    'pin.eraseMsg': 'If you forgot your PIN, the only way back in is to erase Bloom Tab on this computer. Your settings, Home screen, notes, reminders, events, alarms, pictures, recordings and music are deleted, together with the PIN. This can’t be undone.',
    'pin.erase': 'Erase',
  },
  ar: {
    'pin.pin': 'رمز PIN',
    'pin.enter': 'أدخل رمز PIN',
    'pin.set': 'تعيين رمز PIN',
    'pin.setTitle': 'عيّن رمز PIN',
    'pin.rule': 'يجب أن يتكون رمز PIN من {min} إلى {max} رقمًا.',
    'pin.continue': 'متابعة',
    'pin.confirm': 'تأكيد رمز PIN',
    'pin.confirmSub': 'أدخل رمز PIN نفسه مرة أخرى.',
    'pin.verifySub': 'أدخل رمز PIN الحالي للمتابعة.',
    'pin.mismatch': 'رمزا PIN غير متطابقين. حاول مرة أخرى.',
    'pin.wrong': 'رمز PIN غير صحيح',
    'pin.left1': 'محاولة واحدة أخرى قبل الانتظار',
    'pin.leftN': '{n} محاولات أخرى قبل الانتظار',
    'pin.tooMany': 'محاولات خاطئة كثيرة.',
    'pin.tryIn': 'حاول مرة أخرى بعد {when}.',
    'pin.forgot': 'هل نسيت رمز PIN؟',
    'pin.delete': 'حذف',
    'pin.keypad': 'لوحة الأرقام',
    'pin.typed': 'تم إدخال {n} من الأرقام',
    'pin.eraseTitle': 'هل تريد مسح Bloom Tab؟',
    'pin.eraseMsg': 'إذا نسيت رمز PIN، فالطريقة الوحيدة للدخول هي مسح Bloom Tab على هذا الكمبيوتر. ستُحذف إعداداتك والشاشة الرئيسية والملاحظات والتذكيرات والأحداث والمنبهات والصور والتسجيلات والموسيقى مع رمز PIN. لا يمكن التراجع عن ذلك.',
    'pin.erase': 'مسح',
  },
});
