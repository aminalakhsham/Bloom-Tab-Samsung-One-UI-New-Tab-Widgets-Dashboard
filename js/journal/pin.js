// Lock Journal PIN: hashing and the wrong-try policy. Pure Web Crypto (no DOM, no storage), so the plain-node test
// runs it too. The PIN itself is never stored: only a PBKDF2-SHA-256 hash with a random salt.
//
// Record shape (store key 'journalLock', written by lock.js):
//   { on, kind: 'journal', alg: 'PBKDF2-SHA256', iter, salt (base64), hash (base64), digits, after (minutes),
//     fails, until (ms, wrong-try lockout) }
// `kind` says who owns the PIN. Today it is always 'journal' (a Journal-only PIN). When the shell gets its screen-lock
// PIN (roadmap S1), a record with kind 'screen' will carry no hash and lock.js will verify with the shell instead.

export const ITER = 150000;
export const MIN = 4, MAX = 6;
/** Wrong tries allowed before a wait. */
export const TRIES = 5;

export const validPin = (pin) => new RegExp(`^\\d{${MIN},${MAX}}$`).test(String(pin));

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}

/** A new record for `pin`: { alg, iter, salt, hash, digits }. */
export async function hashPin(pin, iter = ITER) {
  if (!validPin(pin)) throw new Error('PIN must be 4 to 6 digits');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { alg: 'PBKDF2-SHA256', iter, salt: b64(salt), hash: b64(await derive(pin, salt, iter)), digits: String(pin).length };
}

/** True when `pin` matches the record (compared in constant time). */
export async function checkPin(pin, rec) {
  if (!rec?.hash || !rec.salt || !validPin(pin)) return false;
  const a = new Uint8Array(await derive(pin, unb64(rec.salt), rec.iter || ITER));
  const b = unb64(rec.hash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** How long to wait after `fails` wrong tries in a row: nothing for the first 4, then 30 s, doubling every 5 more (max 15 min). */
export function waitAfter(fails) {
  if (fails < TRIES) return 0;
  return Math.min(15 * 60e3, 30e3 * 2 ** Math.floor((fails - TRIES) / TRIES));
}
