// The recording in progress, shared by everything that shows it: the Now Bar activity, the Quick Panel tile and the
// widgets (all registered by js/apps/recorder.js at every new tab) and the app's screens. The engine, which loads only
// when a recording starts, publishes here; this file stays tiny on purpose.
//   live() -> null | { id, title, mode, paused, elapsed() (s), stop(), toggle(), mark() }
let cur = null;
const subs = new Set();

export const live = () => cur;
export const onLive = (fn) => (subs.add(fn), () => subs.delete(fn));
export function setLive(v) {
  cur = v;
  subs.forEach((fn) => {
    try {
      fn(cur);
    } catch (e) {
      console.error(e);
    }
  });
}
