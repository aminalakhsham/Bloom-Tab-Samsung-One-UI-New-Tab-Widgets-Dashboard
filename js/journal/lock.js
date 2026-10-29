// Lock Journal: whether the journal is locked right now, the PIN check with its wrong-try lockout, and turning the lock
// on and off. Small and synchronous enough for Finder search and widgets (they ask lockNeeded() before showing text).
//
// The lock uses a Journal-only 4–6 digit PIN (pin.js), or the screen lock PIN (Settings › Lock screen, js/shell/pin.js)
// with kind 'screen'. Everything that checks a PIN goes through PROVIDERS[rec.kind]; callers don't change. The 'screen'
// provider keeps no hash of its own: the shell checks the PIN and counts the wrong tries (its lockout applies, so the
// Journal is no faster a way to guess the screen PIN). useScreenPin() switches to it (Journal settings can offer it
// while screenPinAvailable()); removing the screen PIN leaves the Journal unlocked, as One UI does for apps that
// follow the screen lock.
import { store, session } from '../core/store.js';
import { isExt } from '../core/util.js';
import { LOCK_KEY } from './model.js';
import { hashPin, checkPin, waitAfter } from './pin.js';

export const AFTER = [0, 1, 5, 15, 60]; // "Lock automatically": minutes after the Journal was last used (0 = when it closes)

const PROVIDERS = {
  journal: { verify: (pin, rec) => checkPin(pin, rec) },
  // → { ok, wait (s), fails }: the shell's own count and lockout
  screen: {
    own: true,
    verify: (pin) => import('../shell/pin.js').then((m) => m.tryPin(pin)).then((r) => ({ ok: r.ok, wait: Math.ceil((r.wait || 0) / 1000), fails: r.n || 0 })),
  },
};
const screenPin = () => store.get('pin') || null;
/** The screen lock has a PIN the Journal can use. */
export const screenPinAvailable = () => !!screenPin()?.hash;

export function rec() {
  const v = store.get(LOCK_KEY);
  const r = v && typeof v === 'object' ? { kind: 'journal', after: 0, fails: 0, until: 0, ...v } : { on: false, kind: 'journal', after: 0, fails: 0, until: 0 };
  // the screen PIN's length, so the keypad checks it as soon as the last digit is in
  if (r.kind === 'screen') r.digits = screenPin()?.digits || 0;
  return r;
}
/** Lock Journal is on (and there is a PIN to open it with). */
export const lockOn = () => {
  const r = rec();
  if (r.kind === 'screen') return !!r.on && screenPinAvailable();
  return !!r.on && (r.kind !== 'journal' || !!r.hash);
};

// When the unlocked journal was last in use, shared by every tab and forgotten when Chrome quits (chrome.storage.session):
// "Lock automatically after 5 minutes" counts from there.
let seen = 0;
session.get('journalSeen').then((v) => (seen = Math.max(seen, +v || 0))).catch(() => {});
if (isExt && chrome.storage?.session) {
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'session' && c.journalSeen) seen = Math.max(seen, +c.journalSeen.newValue || 0);
    if (area === 'session' && c.journalSeen && !c.journalSeen.newValue) seen = 0;
  });
}
export function markSeen(at = Date.now()) {
  seen = at;
  Promise.resolve(session.set('journalSeen', at)).catch(() => {});
}
/** Locks the journal everywhere at once (Lock now, a new PIN). */
export function forget() {
  seen = 0;
  open = false;
  Promise.resolve(session.set('journalSeen', 0)).catch(() => {});
}
// The Journal open and unlocked in this tab (set by the app while it shows entries).
let open = false;
export const setOpen = (v) => (open = !!v);
/** True when opening the journal has to ask for the PIN now. Finder and the lock widget show no entries then. */
export function lockNeeded(now = Date.now()) {
  if (!lockOn() || open) return false;
  const after = rec().after || 0;
  // "When Journal closes": a closed journal is always locked; otherwise it counts from the last use
  if (!after) return true;
  return !seen || now - seen > after * 60e3;
}
/** Seconds still to wait after too many wrong PINs (0 = may try). */
export const waitLeft = (now = Date.now()) => Math.max(0, Math.ceil(((rec().kind === 'screen' ? +store.get('pinTries')?.until || 0 : rec().until || 0) - now) / 1000));

/** Checks a PIN against the lock. → { ok } or { ok: false, wait (s), fails } */
export async function verify(pin) {
  const r = rec();
  if (waitLeft()) return { ok: false, wait: waitLeft(), fails: r.fails };
  const P = PROVIDERS[r.kind] || PROVIDERS.journal;
  if (P.own) {
    const res = await P.verify(pin, r);
    if (res.ok) markSeen();
    return res.ok ? { ok: true } : { ok: false, wait: res.wait, fails: res.fails };
  }
  const ok = await P.verify(pin, r);
  if (ok) {
    if (r.fails || r.until) store.set(LOCK_KEY, { ...r, fails: 0, until: 0 });
    markSeen();
    return { ok: true };
  }
  const fails = (r.fails || 0) + 1, wait = waitAfter(fails);
  store.set(LOCK_KEY, { ...r, fails, until: wait ? Date.now() + wait : 0 });
  return { ok: false, wait: Math.ceil(wait / 1000), fails };
}

/** Turns Lock Journal on with a new PIN (or changes the PIN). */
export async function setPin(pin) {
  const h = await hashPin(pin);
  const r = rec();
  store.set(LOCK_KEY, { ...r, ...h, on: true, kind: 'journal', fails: 0, until: 0 });
  markSeen();
}
/** Locks the Journal with the screen lock PIN instead of a PIN of its own (needs one: screenPinAvailable()). */
export function useScreenPin() {
  if (!screenPinAvailable()) return false;
  const r = rec();
  store.set(LOCK_KEY, { on: true, kind: 'screen', after: r.after || 0, fails: 0, until: 0 });
  markSeen();
  return true;
}
export function setAfter(min) {
  store.set(LOCK_KEY, { ...rec(), after: AFTER.includes(+min) ? +min : 0 });
}
/** Turns Lock Journal off and forgets the PIN hash. */
export function turnOff() {
  const r = rec();
  store.set(LOCK_KEY, { on: false, kind: 'journal', after: r.after || 0, fails: 0, until: 0 });
}
