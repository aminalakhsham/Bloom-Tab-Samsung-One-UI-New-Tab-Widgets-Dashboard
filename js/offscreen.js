// Offscreen document (offscreen.html): Bloom Tab's audio host. Chrome lets an extension keep one hidden page that
// may play sound, so music (and any later chime or alarm tone) keeps playing while you browse and after every new
// tab is closed. The service worker creates it (ensureOffscreen() in js/bg/music.js) and drives it with messages:
//
//   chrome.runtime.sendMessage({ target: 'offscreen', type, ... })
//     music  { music, pos }                    Samsung Music: make the player match store keys 'music' / 'musicPos'
//     chime  { tone: 'chime'|'bell'|'beep', volume }   a short synthesized notification sound
//     play   { channel, src, volume, loop }    play a file in a named channel (replaces what the channel played);
//                                              src = extension path ('sounds/x.mp3') or 'blob:<key>' (js/core/blobs.js)
//     stop   { channel? }                      stop one channel, or every channel
//     volume { channel, volume }
//
// It answers with { type: 'offscreen-ready' } once loaded, { type: 'music-report', r } for the music player and
// { type: 'audio-ended', channel } when a channel's sound ends. Chrome closes the document after ~30 s of silence;
// the service worker simply creates it again next time.
import { MusicEngine } from './music/engine.js';
import { mdb } from './music/db.js';
import { getBlob } from './core/blobs.js';

const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

// ——— music ———
const music = new MusicEngine((r) => send({ type: 'music-report', r }));

// media keys, Chrome's media controls and the lock screen of the OS
let artFor = null, artUrl = null;
async function session(m) {
  const ms = navigator.mediaSession;
  if (!ms) return;
  const now = m?.queue?.length ? m.now : null;
  if (!now) {
    ms.metadata = null;
    ms.playbackState = 'none';
    return;
  }
  ms.playbackState = m.playing ? 'playing' : 'paused';
  if (artFor !== now.art) {
    artFor = now.art;
    if (artUrl) URL.revokeObjectURL(artUrl);
    const b = now.art ? await mdb.getArt(now.art).catch(() => null) : null;
    artUrl = b ? URL.createObjectURL(b) : null;
  }
  ms.metadata = new MediaMetadata({ title: now.title || '', artist: now.artist || '', album: now.album || '', artwork: artUrl ? [{ src: artUrl, sizes: '600x600', type: 'image/jpeg' }] : [] });
}
const cmd = (c) => () => send({ type: 'music-cmd', cmd: c });
try {
  navigator.mediaSession.setActionHandler('play', cmd('play'));
  navigator.mediaSession.setActionHandler('pause', cmd('pause'));
  navigator.mediaSession.setActionHandler('nexttrack', cmd('next'));
  navigator.mediaSession.setActionHandler('previoustrack', cmd('prev'));
} catch {}

// ——— chimes (synthesized, no files) ———
let ac = null;
function chime(tone = 'chime', volume = 0.8) {
  ac ||= new AudioContext();
  ac.resume().catch(() => {});
  const notes = { chime: [[880, 0], [1320, 0.16]], bell: [[660, 0], [990, 0], [1320, 0.02]], beep: [[1000, 0], [1000, 0.25]] }[tone] || [[880, 0]];
  const t0 = ac.currentTime + 0.02, v = Math.max(0, Math.min(1, volume)) * 0.35;
  for (const [f, at] of notes) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = tone === 'beep' ? 'square' : 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t0 + at);
    g.gain.linearRampToValueAtTime(v, t0 + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + (tone === 'beep' ? 0.18 : 1.4));
    o.connect(g).connect(ac.destination);
    o.start(t0 + at);
    o.stop(t0 + at + 1.5);
  }
}

// ——— channels: files played by other features ———
const channels = new Map(); // name -> { audio, url }
async function play({ channel = 'default', src, volume = 1, loop = false }) {
  stop(channel);
  if (!src) return;
  let url = src, own = null;
  if (src.startsWith('blob:') && !src.startsWith('blob:chrome-extension')) {
    const b = await getBlob(src.slice(5)).catch(() => null);
    if (!b) return;
    url = own = URL.createObjectURL(b);
  } else if (!/^[a-z-]+:/.test(src)) url = chrome.runtime.getURL(src);
  const audio = new Audio(url);
  audio.loop = !!loop;
  audio.volume = Math.max(0, Math.min(1, volume));
  audio.addEventListener('ended', () => {
    if (channels.get(channel)?.audio !== audio) return;
    stop(channel);
    send({ type: 'audio-ended', channel });
  });
  channels.set(channel, { audio, url: own });
  audio.play().catch(() => stop(channel));
}
function stop(channel) {
  for (const [name, c] of channels) {
    if (channel && name !== channel) continue;
    c.audio.pause();
    c.audio.removeAttribute('src');
    if (c.url) URL.revokeObjectURL(c.url);
    channels.delete(name);
  }
}

chrome.runtime.onMessage.addListener((m) => {
  if (m?.target !== 'offscreen') return;
  if (m.type === 'music') {
    music.apply(m.music, m.pos);
    session(m.music);
  } else if (m.type === 'chime') chime(m.tone, m.volume);
  else if (m.type === 'play') play(m);
  else if (m.type === 'stop') stop(m.channel);
  else if (m.type === 'volume') {
    const c = channels.get(m.channel);
    if (c) c.audio.volume = Math.max(0, Math.min(1, m.volume));
  }
});

send({ type: 'offscreen-ready' });
