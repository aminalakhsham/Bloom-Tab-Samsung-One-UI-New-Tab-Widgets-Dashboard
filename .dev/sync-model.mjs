// Plain-node tests for the pure parts of js/bg/sync.js: encoding (deflate + base64) and chunking under the 8 KB item
// limit, what may be synced, per-device settings, merging settings from another computer, content hashes.
// usage: node .dev/sync-model.mjs   (exit 1 on failure)
import * as M from '../js/bg/sync.js';

let pass = 0, fail = 0;
const ok = (c, msg) => (c ? (pass++, console.log('  ok', msg)) : (fail++, console.log('FAIL', msg)));
const bytes = (s) => Buffer.byteLength(s);

// ——— encoding and chunks ———
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const notes = Array.from({ length: 60 }, (_, i) => ({ id: 'n' + i, title: 'ملاحظة ' + i, body: Array.from({ length: 400 }, () => 'abcdefghijklmnopqrstuvwxyz ابتثجحخدذرزسشص'[Math.floor(rnd() * 41)]).join(''), updated: i }));
const enc = await M.encodeValue(notes);
ok(/^[A-Za-z0-9+/=]+$/.test(enc), 'encoded value is plain base64');
ok(JSON.stringify(await M.decodeValue(enc)) === JSON.stringify(notes), 'decode(encode(x)) is x (Arabic included)');
const parts = M.chunkString(enc);
ok(parts.length > 1 && parts.join('') === enc, `long value cut into ${parts.length} chunks that join back`);
ok(parts.every((p, i) => bytes(`c:notes:${i}`) + bytes(JSON.stringify(p)) <= 8192), 'every chunk item (key + JSON) fits 8192 bytes');
ok(M.chunkString('').length === 1 && M.chunkString('abc').length === 1, 'an empty or short value is one chunk');
const small = { a: 'x'.repeat(5000) };
ok((await M.encodeValue(small)).length < 200, 'repetitive JSON compresses well');

// ——— what syncs ———
for (const k of ['settings', 'home', 'dock', 'notes', 'reminders', 'events', 'alarms', 'clocks', 'contacts', 'wallet', 'routines']) ok(M.isSyncable(k), `${k} syncs`);
for (const k of ['pin', 'pinTries', 'journal', 'journalLock', 'health', 'healthPrefs', 'wellbeingUsage', 'music', 'musicLib', 'recorder', 'canvas', 'wallPhotos', 'wallpaperImage', 'notesLocked', 'notifications', 'syncPrefs', 'syncState', 'games', 'weather'])
  ok(!M.isSyncable(k), `${k} never syncs`);
ok(M.syncKeys({ on: false }).length === 0, 'sync off: no keys');
const all = M.syncKeys({ on: true });
ok(all.includes('notes') && all.includes('settings') && !all.some((k) => /^(pin|journal|health|music)/.test(k)), 'sync on: every category');
const noNotes = M.syncKeys({ on: true, off: ['notes', 'wallet'] });
ok(!noNotes.includes('notes') && !noNotes.includes('noteFolders') && !noNotes.includes('wallet') && noNotes.includes('reminders'), 'categories turned off leave their keys out');

// ——— per-device settings ———
const mine = { lang: 'ar', brightness: 60, lockMode: 'idle', lockAfter: 5, onboarded: true, theme: 'dark', focusMinutes: 45, wallpaper: { type: 'photo', id: 'p1' }, lockWallpaper: { type: 'shuffle' }, accent: '#22b07d' };
const up = M.stripDevice(mine);
ok(!('lang' in up) && !('brightness' in up) && !('lockMode' in up) && !('lockAfter' in up) && !('onboarded' in up), 'language, brightness, lock timing and the tour stay per device');
ok(!up.wallpaper && !up.lockWallpaper && up.theme === 'dark' && up.accent === '#22b07d', 'a photo wallpaper stays, the rest goes up');
ok(M.stripDevice({ wallpaper: { type: 'preset', id: 'aurora' } }).wallpaper?.id === 'aurora', 'a preset wallpaper goes up');
const other = { theme: 'light', focusMinutes: 25, lang: 'en', brightness: 100, wallpaper: { type: 'preset', id: 'ocean' }, extra: 1 };
const merged = M.mergeSettings(mine, other);
ok(merged.theme === 'light' && merged.focusMinutes === 25 && merged.extra === 1, 'settings from another computer are taken');
ok(merged.lang === 'ar' && merged.brightness === 60 && merged.lockMode === 'idle', '…but this computer keeps its own language, brightness and lock timing');
ok(merged.wallpaper?.type === 'photo' && merged.lockWallpaper?.type === 'shuffle', '…and its photo wallpaper and Dynamic Lock screen');
ok(M.mergeSettings({ wallpaper: { type: 'preset', id: 'bloom' } }, other).wallpaper.id === 'ocean', 'a preset wallpaper follows the other computer');
ok(!('lang' in M.mergeSettings({}, { lang: 'en' })), 'a language never arrives from sync');

// ——— hashes ———
ok(M.hashOf('notes', { a: 1, b: 2 }) === M.hashOf('notes', { b: 2, a: 1 }), 'hash ignores key order');
ok(M.hashOf('notes', [1, 2]) !== M.hashOf('notes', [2, 1]), 'hash sees list order');
ok(M.hashOf('settings', { ...up, lang: 'en' }) === M.hashOf('settings', { ...up, lang: 'ar' }), 'settings hash ignores per-device settings');

console.log(`---- ${pass} passed, ${fail} failed ----`);
process.exit(fail ? 1 : 0);
