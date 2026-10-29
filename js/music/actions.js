// Samsung Music's actions for Modes and Routines ("Then"): Media control (play, pause, play/pause, next, previous) and
// Play playlist (a playlist of yours or a built-in one, optionally shuffled). Playback lives in the offscreen document
// the service worker drives; these run in a page, which tells it what to do (js/music/player.js). The playlist list
// is read from storage each time the editor shows it, so the library itself only loads when a routine plays one.
// Imported by js/apps/music.js; `control` is its light remote (the same one the widgets and Finder use).
import { registerAction, RunError } from '../routines/actions.js';
import { addStrings } from '../core/i18n.js';
import { store } from '../core/store.js';

const P = (key, type, label, o = {}) => ({ key, type, label, ...o });
// Samsung Music's built-in playlists, in its order, then the user's own (newest first, as the Playlists tab lists them)
export const SMART_LISTS = [['smart:fav', 'music.favTracks'], ['smart:most', 'music.mostPlayed'], ['smart:played', 'music.recentPlayed'], ['smart:added', 'music.recentAdded']];
/** [value, label] pairs: every track, the built-in playlists and the user's playlists (labels are i18n keys or names). */
export const listChoices = () => [['all', 'music.tracks'], ...SMART_LISTS, ...((store.get('musicLib') || {}).playlists || []).map((p) => ['playlist:' + p.id, p.name || 'music.newPlaylist'])];

export function registerMusicActions(control) {
  registerAction({
    id: 'music.control', name: 'music.ra.control', icon: 'music', color: '#fc5c65', cat: 'sound',
    params: [P('cmd', 'enum', 'music.ra.cmd', { opts: [['toggle', 'music.ra.toggle'], ['play', 'music.play'], ['pause', 'music.pause'], ['next', 'music.next'], ['prev', 'music.prev']], def: 'toggle' })],
    sub: (p, F) => F.opt('music.control', 'cmd', p.cmd || 'toggle'),
    run(ctx, p) {
      const cmd = ['toggle', 'play', 'pause', 'next', 'prev'].includes(p.cmd) ? p.cmd : 'toggle';
      return control(cmd);
    },
  });
  registerAction({
    id: 'music.playlist', name: 'music.ra.playlist', icon: 'playlist', color: '#fc5c65', cat: 'sound',
    params: [
      // a getter: playlists made after the app loaded show up the next time the action's settings open
      { key: 'list', type: 'enum', label: 'music.ra.list', def: 'smart:fav', get opts() { return listChoices(); } },
      P('shuffle', 'bool', 'music.ra.shuffle', { def: false }),
    ],
    sub: (p, F) => F.opt('music.playlist', 'list', p.list || 'smart:fav'),
    async run(ctx, p) {
      const [kind, id = ''] = String(p.list || 'smart:fav').split(':');
      const P2 = await import('./player.js');
      if (!(await P2.playSource(kind === 'all' ? 'all' : kind, id, { shuffle: p.shuffle === true }))) throw new RunError('music.ra.errEmpty');
    },
  });
}

addStrings({
  en: {
    'music.ra.control': 'Media control', 'music.ra.cmd': 'Action', 'music.ra.toggle': 'Play/pause',
    'music.ra.playlist': 'Play playlist', 'music.ra.list': 'Playlist', 'music.ra.shuffle': 'Shuffle',
    'music.ra.errEmpty': 'There are no tracks to play in that playlist.',
    'music.w.pickList': 'Playlist to show',
  },
  ar: {
    'music.ra.control': 'التحكم في الوسائط', 'music.ra.cmd': 'الإجراء', 'music.ra.toggle': 'تشغيل/إيقاف مؤقت',
    'music.ra.playlist': 'تشغيل قائمة تشغيل', 'music.ra.list': 'قائمة التشغيل', 'music.ra.shuffle': 'ترتيب عشوائي',
    'music.ra.errEmpty': 'لا توجد مقاطع لتشغيلها في قائمة التشغيل هذه.',
    'music.w.pickList': 'قائمة التشغيل المعروضة',
  },
});
