// Samsung Music in the service worker: keeps the offscreen player (offscreen.html, js/offscreen.js) in step with the
// stored state, moves on when a track ends, counts plays, runs the sleep timer and answers media keys.
// Pages only write store key 'music'; this module notices (storage change, or a 'music-sync' message) and tells the
// offscreen document, which reports back with 'music-report' messages that become store key 'musicPos'.
//
// The offscreen document is a general audio host. Other background modules can use it too:
//   import { toOffscreen, onOffscreenReady } from './music.js';
//   toOffscreen({ type: 'chime', tone: 'bell', volume: 0.8 });
//   toOffscreen({ type: 'play', channel: 'alarm', src: 'sounds/ring.mp3', loop: true });  toOffscreen({ type: 'stop', channel: 'alarm' });
import { onMessage, onAlarm } from './hub.js';
import { mdb } from '../music/db.js';
import { withDefaults, nextPatch, prevPatch, goTo, livePos } from '../music/core.js';

const SLEEP = 'music:sleep';

// ——— offscreen document ———
let creating = null, readyWait = null;
const readyFns = new Set();
export const onOffscreenReady = (fn) => readyFns.add(fn);

export async function hasOffscreen() {
  if (chrome.runtime.getContexts) return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
  return !!(await chrome.offscreen?.hasDocument?.());
}

/** Creates the offscreen document when it isn't there; resolves once it can take messages. */
export async function ensureOffscreen() {
  if (!chrome.offscreen) return false;
  if (await hasOffscreen()) return true;
  if (!creating) {
    let ready;
    readyWait = new Promise((r) => (ready = r));
    readyWait.done = ready;
    creating = chrome.offscreen
      .createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Plays the music and sounds chosen by the user while they browse.' })
      .then(() => Promise.race([readyWait, new Promise((r) => setTimeout(r, 1500))]))
      .catch((e) => console.warn('offscreen', e))
      .finally(() => (creating = null));
  }
  await creating;
  return true;
}

/** Send a message to the offscreen document ({ type, ... }), creating it first unless `create` is false. */
export async function toOffscreen(msg, create = true) {
  if (create) await ensureOffscreen();
  else if (!(await hasOffscreen())) return false;
  await chrome.runtime.sendMessage({ target: 'offscreen', ...msg }).catch(() => {});
  return true;
}

// one change at a time: storage reads and writes of 'music' must not interleave
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.catch(() => {}).then(fn).catch((e) => console.warn('music', e)));

// ——— keeping the player in step ———
async function syncMusic() {
  const { music, musicPos } = await chrome.storage.local.get(['music', 'musicPos']);
  const m = withDefaults(music);
  if (m.playing && m.sleepAt > Date.now()) {
    const a = await chrome.alarms.get(SLEEP);
    if (a?.scheduledTime !== m.sleepAt) chrome.alarms.create(SLEEP, { when: m.sleepAt });
  } else chrome.alarms.clear(SLEEP);
  // nothing to play: only an existing player needs to hear it (it fades out; Chrome then closes the silent document)
  await toOffscreen({ type: 'music', music: m, pos: musicPos || null }, m.playing && m.queue.length > 0);
}

async function lookupFor() {
  const list = await mdb.tracks().catch(() => []);
  const map = new Map(list.map((x) => [x.id, x]));
  return (id) => map.get(id);
}

async function setMusic(m, patch) {
  const next = { ...m, ...patch };
  delete next.end;
  if (patch.playing && !m.playing) next.at = Date.now();
  const out = { music: next };
  if (patch.seek) out.musicPos = { id: next.queue[next.index], pos: patch.seek.pos || 0, at: Date.now(), dur: next.now?.dur || 0, playing: false };
  await chrome.storage.local.set(out);
}

let errors = 0;
async function report(r) {
  if (!r?.id) return;
  if (r.type === 'pos') {
    if (r.playing) errors = 0;
    await chrome.storage.local.set({ musicPos: { id: r.id, pos: r.pos, dur: r.dur, playing: r.playing, at: Date.now() } });
  } else if (r.type === 'played') {
    const { musicStats = {} } = await chrome.storage.local.get('musicStats');
    musicStats[r.id] = [(musicStats[r.id]?.[0] || 0) + 1, Date.now()];
    await chrome.storage.local.set({ musicStats });
  } else if (r.type === 'ended' || r.type === 'error') {
    // read the library first: between reading 'music' and writing it back nothing may wait, or a page's change
    // made meanwhile (Play next, a new queue) would be overwritten
    const lookup = await lookupFor();
    const { music } = await chrome.storage.local.get('music');
    const m = withDefaults(music);
    if (m.queue[m.index] !== r.id) return;
    // a run of unplayable files stops playback instead of spinning through the queue
    if (r.type === 'error' && ++errors > 4) {
      errors = 0;
      return setMusic(m, { playing: false });
    }
    let p = nextPatch(m, lookup, true);
    // the end of the queue (repeat off): stop and go back to the first track, like Samsung Music
    if (p?.end) p = { ...goTo(m, 0, lookup, false), user: 0 };
    if (m.sleepEnd && m.sleepEnd === r.id) p = { ...p, playing: false, sleepEnd: null };
    if (p) await setMusic(m, p);
  }
}

/** Media keys and Chrome's media controls (through the offscreen document), or a page's request. */
async function command(cmd) {
  const lookup = cmd === 'next' || cmd === 'prev' ? await lookupFor() : null;
  const { music, musicPos } = await chrome.storage.local.get(['music', 'musicPos']);
  const m = withDefaults(music);
  if (!m.queue.length) return;
  if (cmd === 'play' || cmd === 'pause' || cmd === 'toggle') return setMusic(m, { playing: cmd === 'toggle' ? !m.playing : cmd === 'play' });
  let p = cmd === 'next' ? nextPatch(m, lookup) : cmd === 'prev' ? prevPatch(m, lookup, livePos(musicPos?.id === m.queue[m.index] ? musicPos : null, m.speed)) : null;
  if (p?.end) p = { ...goTo(m, 0, lookup, false), user: 0 };
  if (p) await setMusic(m, p);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.music) serial(syncMusic);
});

// don't surprise anyone with music after the browser restarts
chrome.runtime.onStartup.addListener(() =>
  serial(async () => {
    const { music } = await chrome.storage.local.get('music');
    if (music?.playing || music?.sleepAt) await chrome.storage.local.set({ music: { ...music, playing: false, sleepAt: 0, sleepEnd: null } });
  }));

onMessage('music-sync', () => serial(syncMusic));
onMessage('music-report', (msg) => serial(() => report(msg.r)));
onMessage('music-cmd', (msg) => serial(() => command(msg.cmd)));
onMessage('offscreen-ready', () => {
  readyWait?.done?.();
  readyFns.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn('offscreen-ready', e);
    }
  });
  return serial(syncMusic);
});

// Sleep timer ('music:sleep')
onAlarm('music', (rest) =>
  serial(async () => {
    if (rest !== 'sleep') return;
    const { music } = await chrome.storage.local.get('music');
    if (music) await chrome.storage.local.set({ music: { ...music, playing: false, sleepAt: 0, sleepEnd: null } });
  }));
