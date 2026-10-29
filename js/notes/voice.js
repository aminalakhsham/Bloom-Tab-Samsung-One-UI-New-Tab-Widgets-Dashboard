// A voice recording for a note (Samsung Notes' Insert › Voice recording), kept small: the microphone through
// MediaRecorder with a live level meter and the time, Stop adds it to the note. The microphone error dialogs and the
// time format are Voice Recorder's own (imported from js/recorder/), so both apps say the same thing.
import { h } from '../core/util.js';
import { t } from '../core/i18n.js';
import { dialog } from '../core/ui.js';
import { fmtLen } from '../recorder/model.js';

const MAX_MS = 30 * 60e3;

/** Records until Stop (or Cancel). Resolves the audio Blob, or null. */
export async function recordVoice() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const { micError } = await import('../recorder/common.js');
    micError(e);
    return null;
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => globalThis.MediaRecorder?.isTypeSupported?.(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
  const chunks = [];
  rec.addEventListener('dataavailable', (e) => e.data.size && chunks.push(e.data));
  const stopped = new Promise((r) => rec.addEventListener('stop', r, { once: true }));

  // the level meter: a row of bars that follow the microphone, Samsung's red
  let ac = null, an = null;
  try {
    ac = new AudioContext();
    an = ac.createAnalyser();
    an.fftSize = 256;
    ac.createMediaStreamSource(stream).connect(an);
  } catch {}
  const bars = Array.from({ length: 28 }, () => h('i'));
  const time = h('div', { class: 'nt-rec-time', dir: 'ltr' }, '00:00');
  const content = h('div', { class: 'nt-rec' }, h('div', { class: 'nt-rec-dot' }), time, h('div', { class: 'nt-rec-meter', 'aria-hidden': 'true' }, bars));
  const t0 = Date.now();
  const buf = new Uint8Array(128);
  let raf = 0, closeDlg = null;
  const level = [];
  const tick = () => {
    const ms = Date.now() - t0;
    time.textContent = fmtLen(ms / 1000);
    if (an) {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      level.push(Math.min(1, peak / 64));
      if (level.length > bars.length) level.shift();
      bars.forEach((b, i) => (b.style.transform = `scaleY(${0.12 + (level[i - bars.length + level.length] ?? 0) * 0.88})`));
    }
    if (ms >= MAX_MS) return closeDlg?.(true);
    raf = requestAnimationFrame(tick);
  };
  rec.start(250);
  raf = requestAnimationFrame(tick);
  const ask = dialog({
    title: t('notes.voice'),
    className: 'nt-rec-dlg',
    content,
    actions: [{ label: t('common.cancel'), value: false }, { label: t('notes.stopRec'), value: true, primary: true }],
  });
  closeDlg = (v) => content.closest('.ou-dialog')?._close?.(v);
  const ok = await ask;
  cancelAnimationFrame(raf);
  if (rec.state !== 'inactive') rec.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  ac?.close().catch(() => {});
  if (!ok || !chunks.length) return null;
  return new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
}
