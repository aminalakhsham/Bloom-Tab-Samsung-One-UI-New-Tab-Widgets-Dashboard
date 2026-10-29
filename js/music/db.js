// Samsung Music library storage, on this device only, in IndexedDB through js/core/blobs.js:
//   music:index      every track's details (one array, so a page or the service worker reads the library at once
//                    instead of holding it in chrome.storage, which every new tab loads at boot)
//   music:a:<id>     the audio file itself
//   music:art:<id>   a downscaled cover (several tracks share one when the bytes match)
//   music:lrc:<id>   lyrics text (plain or LRC with time stamps)
// Shared by the pages, the service worker and the offscreen player (all on the extension's origin).
//
// A track: { id, title, artist, album, albumArtist, genre, year, track, disc, dur, size, type, name, dir,
//   art, color, addedAt, lrc: true when it has lyrics }
import { putBlob, getBlob, delBlob, listBlobs } from '../core/blobs.js';

const INDEX = 'music:index';
export const audioKey = (id) => 'music:a:' + id;
export const artKey = (id) => 'music:art:' + id;
export const lyricsKey = (id) => 'music:lrc:' + id;

export const mdb = {
  async tracks() {
    const v = await getBlob(INDEX).catch(() => null);
    return Array.isArray(v) ? v : [];
  },
  saveTracks: (list) => putBlob(INDEX, list.map(({ _album, ...x }) => x)),
  getAudio: (id) => getBlob(audioKey(id)),
  putAudio: (id, blob) => putBlob(audioKey(id), blob),
  getArt: (id) => (id ? getBlob(artKey(id)) : Promise.resolve(null)),
  putArt: (id, blob) => putBlob(artKey(id), blob),
  async hasArt(id) {
    return !!(await getBlob(artKey(id)).catch(() => null));
  },
  getLyrics: (id) => getBlob(lyricsKey(id)).then((v) => (typeof v === 'string' ? v : null), () => null),
  putLyrics: (id, text) => (text ? putBlob(lyricsKey(id), String(text)) : delBlob(lyricsKey(id))),
  async deleteTracks(ids) {
    for (const id of ids) await Promise.all([delBlob(audioKey(id)), delBlob(lyricsKey(id))]).catch(() => {});
  },
  /**
   * Deletes covers, audio and lyrics that no track in `list` uses (after deleting tracks, or left by an import cut
   * short). Only call it when no import is running in another tab: an import writes its files before the index.
   */
  async collect(list) {
    const ids = new Set(list.map((x) => x.id)), arts = new Set(list.map((x) => x.art).filter(Boolean));
    const keys = await listBlobs('music:').catch(() => []);
    const stale = keys.filter((k) => {
      const [, kind, id] = k.split(':');
      if (kind === 'a' || kind === 'lrc') return !ids.has(id);
      if (kind === 'art') return !arts.has(id);
      return false;
    });
    for (const k of stale) await delBlob(k).catch(() => {});
    return stale.length;
  },
  async clear() {
    for (const k of await listBlobs('music:').catch(() => [])) await delBlob(k).catch(() => {});
  },
};
