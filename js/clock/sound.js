// Tone previews in the page (the Alarm sound and Timer sound pickers) and, outside the extension where there is no
// service worker or offscreen document, the ringing sound itself. The same WAVs the service worker sends to the
// offscreen audio host (js/clock/tones.js).
import { toneWav } from './tones.js';

const urls = new Map();
const urlOf = (id) => {
  if (!urls.has(id)) urls.set(id, URL.createObjectURL(new Blob([toneWav(id)], { type: 'audio/wav' })));
  return urls.get(id);
};

let cur = null, timer = 0;
/** Plays a tone for a few seconds (`ms`; 0 = until stopSound()). */
export function playTone(id, volume = 0.7, ms = 3500) {
  stopSound();
  if (!id || id === 'silent') return;
  try {
    const a = new Audio(urlOf(id));
    a.loop = true;
    a.volume = Math.max(0, Math.min(1, volume));
    a.play().catch(() => {});
    cur = a;
    if (ms) timer = setTimeout(stopSound, ms);
  } catch {}
}
export function setVolume(v) {
  if (cur) cur.volume = Math.max(0, Math.min(1, v));
}
export function stopSound() {
  clearTimeout(timer);
  if (cur) {
    cur.pause();
    cur = null;
  }
}
export const isPlaying = () => !!cur;
