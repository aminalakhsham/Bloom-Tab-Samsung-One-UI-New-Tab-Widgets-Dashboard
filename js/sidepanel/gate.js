// The side panel's lock (js/shell/pin.js). The panel shows notes and reminders next to any website, so with a screen
// lock PIN nothing is drawn here until it is entered: the same Samsung keypad as the Lock screen, the same wrong-try
// count and lockout, the same "Lock automatically" window (a panel opened within it of using Bloom Tab doesn't ask).
// main.js calls gate(root) before it builds the panel and draws nothing until it resolves true, and calls it again
// (through onRelock) when the panel must lock: the PIN set in another tab, Lock now in a tab, the panel unused for
// longer than "Lock automatically" (or hidden, with "Immediately"). Without a PIN the panel is open, like the Home
// screen behind a Swipe Lock screen.
import { h, throttle } from '../core/util.js';
import { t } from '../core/i18n.js';
import { store, session } from '../core/store.js';
import { pinSet, autoConfirm, pinDigits, keypad, tryPin, wrongText, forgotPin, lockAfter, waitLeft } from '../shell/pin.js';

const relockFns = new Set();
let locked = false, pad = null, open = null, hash = null;

/** True when the panel has to ask for the PIN now. */
async function needed() {
  if (!pinSet()) return false;
  const after = lockAfter();
  if (!after) return true;
  const last = await session.get('lastActive').catch(() => 0);
  return !last || Date.now() - last > after * 60e3;
}
// Using the panel counts as using Bloom Tab (a new tab right after doesn't ask for the PIN either).
const used = throttle(() => !locked && pinSet() && Promise.resolve(session.set('lastActive', Date.now())).catch(() => {}), 15000);

/** Resolves true when the panel may show its content (after the PIN when one is needed). */
export async function gate(root) {
  hash ??= store.get('pin')?.hash || '';
  if (!(await needed())) {
    locked = false;
    return true;
  }
  locked = true;
  return new Promise((resolve) => {
    // opens the panel: the right PIN, or the PIN removed in another tab
    open = () => {
      removeEventListener('keydown', onKey, true);
      pad?.destroy();
      pad = null;
      open = null;
      locked = false;
      resolve(true);
    };
    const onKey = (e) => {
      if (!pad || document.querySelector('.ou-dialog-scrim')) return;
      if (pad.key(e)) e.preventDefault();
    };
    pad = keypad({
      mode: 'page',
      badge: true,
      title: t('pin.enter'),
      len: autoConfirm() ? pinDigits() : 0,
      onSubmit: async (code) => {
        const r = await tryPin(code);
        if (!r.ok) return r.wait ? { wait: r.wait } : wrongText(r.n);
        await Promise.resolve(session.set('lastActive', Date.now())).catch(() => {});
        open?.();
        return true;
      },
      onForgot: () => forgotPin(),
    });
    root.replaceChildren(h('div', { class: 'sp-gate' }, pad.el));
    // main.js shows the page once the panel is built: the keypad has to show before that
    document.body.classList.remove('booting');
    addEventListener('keydown', onKey, true);
    if (waitLeft()) pad.wait(waitLeft());
    setTimeout(() => pad?.el.focus({ preventScroll: true }), 60);
  });
}

/** main.js listens here: fn() hides the content and calls gate() again. */
export const onRelock = (fn) => (relockFns.add(fn), () => relockFns.delete(fn));
/** Locks the panel again (does nothing while the keypad is already up). */
export const relock = () => {
  if (locked) return;
  locked = true;
  relockFns.forEach((fn) => fn());
};

// ——— when the panel locks again ———
['pointerdown', 'keydown', 'wheel'].forEach((ev) => addEventListener(ev, used, { passive: true, capture: true }));
store.on('pin', (v) => {
  const next = v?.hash || '';
  if (hash === null || next === hash) return;
  hash = next;
  // a new PIN (set or changed in another tab) locks an open panel; a removed one opens a locked one
  if (pinSet() && !locked) relock();
  else if (!pinSet() && open) open();
});
if (globalThis.chrome?.storage?.session) {
  // Lock now in any tab (One UI's side key) clears the last use: the panel locks with it
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'session' && 'lastActive' in c && !c.lastActive.newValue && pinSet()) relock();
  });
}
document.addEventListener('visibilitychange', async () => {
  if (!pinSet() || locked) return;
  if (document.hidden) {
    if (!lockAfter()) relock();
  } else if (await needed()) relock();
});
setInterval(async () => {
  if (pinSet() && !locked && !document.hidden && lockAfter() && (await needed())) relock();
}, 20e3);
