// Voice Recorder: what the list, playback and recording screens share — glyphs, date text, and the actions on a
// recording (rename, share, save as file, category, details, Recycle bin) with Samsung's wording.
import { h, sameDay, isExt } from '../core/util.js';
import { addIcons } from '../core/icons.js';
import { t, fmtTime, fmtDate, lang, locale } from '../core/i18n.js';
import { toast, dialog, prompt, choose } from '../core/ui.js';
import * as M from './model.js';
import { D, byId, patch, prefs, audioBlob, trash, restore, addCat, catName } from './data.js';
import { renderWav } from './audio.js';
import { sttAvailability } from './engine.js';
import './strings.js';

addIcons({
  'rec-std': '<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  'rec-interview': '<circle cx="7.5" cy="8" r="2.8"/><path d="M2.5 19a5 5 0 0 1 10 0"/><circle cx="16.5" cy="8" r="2.8"/><path d="M11.5 19a5 5 0 0 1 10 0"/>',
  'rec-stt': '<path d="M3.5 6h10M3.5 10.5h7M3.5 15h5"/><rect x="15" y="8.5" width="4.6" height="8" rx="2.3"/><path d="M13 15.2a4.3 4.3 0 0 0 8.6 0M17.3 19.5V21"/>',
  'rec-wave': '<path d="M4.5 10.5v3M8.25 7.5v9M12 4.5v15M15.75 8v8M19.5 10v4"/>',
  'rec-flag': '<path d="M6 21V4"/><path d="M6 4.5h11.5l-2.8 4.2 2.8 4.3H6"/>',
  'rec-repeat': '<path d="M17 3.5 20 6.5 17 9.5"/><path d="M4 11.5v-2a3 3 0 0 1 3-3h13"/><path d="M7 20.5 4 17.5 7 14.5"/><path d="M20 12.5v2a3 3 0 0 1-3 3H4"/>',
  'rec-skip': '<path d="M3 12h1.5M6.5 9.5v5M10 7.5v9"/><path d="M13.5 12h7M17.5 8.5 21 12l-3.5 3.5"/>',
  'rec-speed': '<path d="M4.2 17.5a8.2 8.2 0 1 1 15.6 0"/><path d="m12 13.5 3.8-4.3"/><circle cx="12" cy="13.8" r="1.3" fill="currentColor"/>',
  'rec-trim': '<circle cx="6" cy="6.5" r="2.6"/><circle cx="6" cy="17.5" r="2.6"/><path d="M8.2 8 20 18M8.2 16 20 6"/>',
  'rec-rew': '<path d="M11.5 6.2v11.6L3.8 12l7.7-5.8Z" fill="currentColor"/><path d="M20.5 6.2v11.6L12.8 12l7.7-5.8Z" fill="currentColor"/>',
  'rec-ff': '<path d="M12.5 6.2v11.6l7.7-5.8-7.7-5.8Z" fill="currentColor"/><path d="M3.5 6.2v11.6l7.7-5.8-7.7-5.8Z" fill="currentColor"/>',
  'rec-tag': '<path d="M3.5 12.3V5A1.5 1.5 0 0 1 5 3.5h7.3l8.2 8.4-8.6 8.6-8.4-8.2Z"/><circle cx="8.2" cy="8.2" r="1.4"/>',
  'rec-restore': '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4.2l2.8 1.8"/>',
  'rec-person': '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  'rec-person-off': '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/><path d="m3.5 3.5 17 17"/>',
});

export const RED = '#f4483f';
export const MODE_ICON = { std: 'rec-std', interview: 'rec-interview', stt: 'rec-stt' };
export const modeName = (mode) => t('recorder.mode.' + mode);

/** List dates: today's time, otherwise the date (with the year when it isn't this year). */
export function dateText(at) {
  const d = new Date(at), now = new Date();
  if (sameDay(d, now)) return fmtTime(d);
  return fmtDate(d, d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
export const fullDate = (at) => `${fmtDate(new Date(at), { year: 'numeric', month: 'long', day: 'numeric' })} ${fmtTime(new Date(at))}`;
/** Times in the UI are left to right in every language (wrapped in an LTR isolate when mixed with text). */
export const ltr = (s) => `⁦${s}⁩`;
export const daysText = (n) => (n === 1 ? t('recorder.day1') : t('recorder.days', { n }));

// ------------------------------------------------------------------ actions on recordings
export async function renameRec(m) {
  const v = (await prompt(t('recorder.rename'), { value: m.title, okLabel: t('common.rename') }))?.trim();
  if (!v || v === m.title) return false;
  patch(m.id, { title: v.slice(0, 120) });
  return true;
}

/** The file for Share / Save as file: the recording as it was made, or a WAV of the kept parts after an edit. */
async function fileOf(m) {
  const blob = await audioBlob(m.id);
  if (!blob) return null;
  if (!m.segs) return { blob, name: `${M.fileName(m.title)}.${M.extOf(m.mime)}` };
  toast(t('recorder.preparing'), { duration: 1400 });
  return { blob: await renderWav(blob, m.segs), name: `${M.fileName(m.title)}.wav` };
}
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 4000);
}
export const canShare = () => typeof navigator.canShare === 'function';
/** Share (the system share sheet where Chrome has one), otherwise the file is saved. */
export async function shareRec(m) {
  const f = await fileOf(m);
  if (!f) return;
  const file = new File([f.blob], f.name, { type: f.blob.type });
  if (canShare() && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: m.title });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  download(f.blob, f.name);
}
export async function saveFile(m) {
  const f = await fileOf(m);
  if (!f) return;
  download(f.blob, f.name);
  toast(t('recorder.savedFile', { name: f.name }));
}

/** Change category of one or more recordings (radio list, with "Add category"). */
export async function changeCategory(ids) {
  const d = D(), cur = ids.length === 1 ? d.items.find((m) => m.id === ids[0])?.cat || '' : null;
  const pick = await choose(t('recorder.changeCat'), [
    { value: '', label: t('recorder.cat.none') },
    ...d.cats.map((c) => ({ value: c.id, label: c.name })),
    { value: '+', label: t('recorder.cat.add') },
  ], cur);
  if (pick == null) return false;
  let id = pick;
  if (pick === '+') {
    const name = (await prompt(t('recorder.cat.add'), { placeholder: t('recorder.cat.name'), okLabel: t('common.add') }))?.trim();
    if (!name) return false;
    id = addCat(name);
  }
  for (const x of ids) patch(x, { cat: id || undefined });
  toast(id ? t('recorder.movedTo', { name: catName(id) }) : t('recorder.movedTo', { name: t('recorder.cat.none') }));
  return true;
}

/** Moves recordings to the Recycle bin (or deletes them when it's off), with Undo. */
export async function trashRecs(ids, { ask = false } = {}) {
  if (!ids.length) return false;
  const bin = prefs().bin;
  if (ask || !bin) {
    const n = ids.length;
    const ok = await dialog({
      title: n === 1 ? t('recorder.deleteOne') : t('recorder.deleteN', { n }),
      message: bin ? t('recorder.toBinMsg') : t('recorder.foreverMsg'),
      actions: [{ label: t('common.cancel'), value: false }, { label: bin ? t('recorder.moveToBin') : t('common.delete'), value: true, danger: true }],
    });
    if (!ok) return false;
  }
  const undo = await trash(ids);
  if (undo) toast(ids.length === 1 ? t('recorder.binnedOne') : t('recorder.binnedN', { n: ids.length }), { action: t('common.undo'), onAction: () => restore(ids) });
  else toast(ids.length === 1 ? t('recorder.deletedOne') : t('recorder.deletedN', { n: ids.length }));
  return true;
}

export function details(m) {
  const r = (k, v) => h('div', { class: 'rec-det-row' }, h('span', null, k), h('b', { dir: 'auto' }, v));
  const marks = M.visibleMarks(m).length;
  return dialog({
    title: t('recorder.details'),
    content: h('div', { class: 'rec-det' },
      r(t('recorder.det.name'), m.title),
      r(t('recorder.det.date'), fullDate(m.at)),
      r(t('recorder.det.length'), ltr(M.fmtLen(M.editLen(m)))),
      r(t('recorder.det.mode'), modeName(m.mode)),
      r(t('recorder.det.cat'), m.cat ? catName(m.cat) : t('recorder.cat.none')),
      r(t('recorder.det.size'), ltr(M.fmtSize(m.size || 0))),
      r(t('recorder.det.format'), m.segs ? t('recorder.det.edited', { f: M.extOf(m.mime).toUpperCase() }) : M.extOf(m.mime).toUpperCase()),
      marks ? r(t('recorder.bookmarks'), String(marks)) : null),
    actions: [{ label: t('common.ok'), value: true, primary: true }],
  });
}

export function copyText(m) {
  const text = M.visibleText(m).map((p) => p.s).join('\n');
  navigator.clipboard?.writeText(text).then(() => toast(t('recorder.copied')), () => {});
}

export function micError(e) {
  console.warn('record', e);
  const n = e?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    return dialog({
      title: t('recorder.micOff'),
      message: t('recorder.micOffMsg'),
      actions: [{ label: t('common.cancel'), value: false }, { label: t('common.settings'), value: true, primary: true }],
    }).then((go) => {
      if (go && isExt && chrome.tabs?.create) chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=${encodeURIComponent(location.origin)}` }).catch(() => {});
    });
  }
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return dialog({ title: t('recorder.noMic'), message: t('recorder.noMicMsg') });
  return dialog({ title: t('recorder.cantRecord'), message: t('recorder.cantRecordMsg') });
}

/** Current item, or null when it was deleted meanwhile. */
export const fresh = (id) => {
  const m = byId(id);
  return m && !m.deletedAt ? m : null;
};

// ------------------------------------------------------------------ Speech-to-text languages
/** Languages offered for Speech-to-text; only those Chrome can recognise on this device are shown. */
export const STT_LANGS = ['en-US', 'en-GB', 'ar-SA', 'ar-EG', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'pt-BR', 'nl-NL', 'ru-RU', 'tr-TR', 'hi-IN', 'id-ID', 'ja-JP', 'ko-KR', 'zh-CN'];
export const langName = (code) => {
  try {
    return new Intl.DisplayNames([locale()], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
};
const defaultSttLang = () => (lang() === 'ar' ? 'ar-SA' : /^[a-z]{2}-[A-Z]{2}$/.test(navigator.language || '') ? navigator.language : 'en-US');
export const rulerText = (sec) => M.fmtLen(sec);

/** Finds the Speech-to-text language to use and whether Chrome can recognise it on the device. */
export async function detectStt(env) {
  const want = prefs().sttLang || defaultSttLang();
  let code = want, state = await sttAvailability(want);
  if (state === 'unavailable' && !prefs().sttLang && want !== 'en-US') {
    const s2 = await sttAvailability('en-US');
    if (s2 !== 'unavailable') (state = s2), (code = 'en-US');
  }
  env.stt = { ok: state !== 'unavailable', lang: code, state };
  return env.stt;
}
