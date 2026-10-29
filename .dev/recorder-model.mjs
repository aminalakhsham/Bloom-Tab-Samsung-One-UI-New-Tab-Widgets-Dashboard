// Voice Recorder pure logic (js/recorder/model.js): data normalising, Samsung names, edits (Trim/Delete) and time
// mapping, bookmarks and Speech-to-text after edits, Skip silence ranges, peaks, Recycle bin expiry, sort, formatting.
// usage: node .dev/recorder-model.mjs   (exit 1 on failure)
import * as M from '../js/recorder/model.js';

let pass = 0, fail = 0;
const ok = (c, msg) => {
  if (c) pass++;
  else {
    fail++;
    console.log('FAIL', msg);
  }
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const eqSegs = (a, b) => JSON.stringify(a.map((r) => r.map((x) => +x.toFixed(4)))) === JSON.stringify(b);

// ——— norm ———
const d0 = M.norm(null);
ok(Array.isArray(d0.items) && Array.isArray(d0.cats) && d0.v === 1, 'norm(null) gives the empty shape');
const d1 = M.norm({
  items: [
    { id: 'a', title: 'Voice 001', at: 10, dur: 5, mode: 'weird', cat: 'gone', pk: 'AAA=', marks: [{ t: 3 }, { t: 'x' }, { t: 1, name: 'Hi' }], speed: 3, segs: [[0, 1], [2, 1]] },
    { id: 'a', title: 'dup', at: 20 },
    { id: 'b', title: 'Voice 002', at: 30, dur: 2, mode: 'interview', pk: 'AA==', pk2: 'AA==', text: [{ t: 0.5, s: 'hello' }, { t: 1, s: '  ' }] },
    null,
    { title: 'no id' },
  ],
  cats: [{ id: 'c1', name: 'Work' }, { id: '', name: 'x' }],
});
ok(d1.items.length === 2 && d1.items[0].id === 'b', 'drops duplicates/invalid, newest first');
const a = d1.items.find((m) => m.id === 'a');
ok(a.mode === 'std' && !a.cat && a.speed === 2 && a.segs.length === 1, 'unknown mode → std, missing category dropped, speed clamped, bad segs dropped');
ok(a.marks.length === 2 && a.marks[0].t === 1 && a.marks[0].name === 'Hi', 'bookmarks sorted, invalid ones dropped');
ok(d1.items[0].text.length === 1 && d1.items[0].pk2 === 'AA==', 'empty sentences dropped, second channel kept');
ok(d1.cats.length === 1, 'invalid categories dropped');
const p = M.normPrefs({ sort: 'nope', quality: 'low', bin: false });
ok(p.sort === 'new' && p.quality === 'low' && p.bin === false && p.askName === true && p.cat === 'all' && p.mode === 'std', 'normPrefs defaults');

// ——— names ———
ok(M.nextTitle([], 'Voice {n}') === 'Voice 001', 'first name is Voice 001');
ok(M.nextTitle([{ title: 'Voice 001' }, { title: 'Voice 007' }, { title: 'Interview 012' }], 'Voice {n}') === 'Voice 008', 'next number after the highest');
ok(M.nextTitle([{ title: 'صوت 004' }], 'صوت {n}') === 'صوت 005', 'Arabic pattern');
ok(M.nextTitle([{ title: 'Voice (1) 003' }], 'Voice (1) {n}') === 'Voice (1) 004', 'regex characters in the pattern are escaped');

// ——— edits ———
const segs = [[0, 10]];
const trimmed = M.keepSegs(segs, 2, 6);
ok(eqSegs(trimmed, [[2, 6]]), 'Trim keeps 2…6');
const cut = M.cutSegs(segs, 3, 5);
ok(eqSegs(cut, [[0, 3], [5, 10]]), 'Delete removes 3…5');
ok(near(M.lenOf(cut), 8), 'length after Delete');
ok(near(M.toOrig(4, cut), 6) && near(M.toEdit(6, cut), 4) && near(M.toEdit(4, cut), 3), 'edited ↔ original time (a removed time maps to the next part)');
const cut2 = M.cutSegs(cut, 1, 4); // edited 1…4 = original 1…3 and 5…6
ok(eqSegs(cut2, [[0, 1], [6, 10]]), 'a second Delete across the gap');
ok(M.tidySegs([[0, 10]], 10) === undefined && JSON.stringify(M.tidySegs(cut, 10)) === '[[0,3],[5,10]]', 'tidySegs drops a whole-recording edit');
ok(M.editLen({ dur: 10, segs: cut }) === 8 && M.editLen({ dur: 4 }) === 4, 'editLen');

// ——— bookmarks / sentences after edits ———
const m = { dur: 10, segs: cut, marks: [{ t: 1 }, { t: 4, name: 'gone' }, { t: 7, name: 'x' }], text: [{ t: 0.2, s: 'one' }, { t: 3.5, s: 'two' }, { t: 6, s: 'three' }] };
const vm = M.visibleMarks(m);
ok(vm.length === 2 && near(vm[1].t, 5) && vm[1].i === 2 && vm[1].name === 'x', 'bookmarks in removed parts are hidden, others move with the edit');
const vt = M.visibleText(m);
ok(vt.length === 2 && vt[1].s === 'three' && near(vt[1].t, 4), 'sentences follow the edit');

// ——— silence ———
const pr = 20, pk = new Uint8Array(200);
for (let i = 0; i < 200; i++) pk[i] = (i < 40 || i >= 120) ? 180 : 2; // sound 0–2 s, silence 2–6 s, sound 6–10 s
const sil = M.silences(pk, pr);
ok(sil.length === 1 && near(sil[0][0], 2.15, 1e-6) && near(sil[0][1], 5.85, 1e-6), 'one silent stretch found, padded (' + JSON.stringify(sil) + ')');
const left = M.subtract([[0, 10]], sil);
ok(left.length === 2 && near(M.lenOf(left), 10 - 3.7, 1e-6), 'Skip silence plays the rest');
ok(M.silences(new Uint8Array(10).fill(200), 20).length === 0, 'no silence in a loud recording');

// ——— peaks ———
const enc = M.encodePeaks(Uint8Array.from([0, 1, 254, 255]));
ok(JSON.stringify([...M.decodePeaks(enc)]) === '[0,1,254,255]', 'peaks round-trip through base64');
ok(M.decodePeaks('***').length === 0, 'bad base64 gives no peaks');
const ep = M.editedPeaks(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 1, [[0, 2], [5, 7]]);
ok(JSON.stringify([...ep]) === '[1,2,6,7]', 'peaks follow the edit');

// ——— Recycle bin ———
const now = Date.UTC(2026, 9, 26);
const day = 86400000;
const bin = { items: [{ id: 'x', deletedAt: now - 31 * day }, { id: 'y', deletedAt: now - 2 * day }, { id: 'z' }] };
ok(M.expired(bin, now).map((x) => x.id).join() === 'x', 'expires after 30 days');
ok(M.daysLeft(bin.items[1], now) === 28 && M.daysLeft({ deletedAt: now }, now) === 30, 'days left');
ok(!M.inCat({ deletedAt: 1 }, 'all') && M.inCat({}, 'all') && M.inCat({}, 'none') && !M.inCat({ cat: 'c' }, 'none') && M.inCat({ cat: 'c' }, 'c'), 'category filter');

// ——— sort / search ———
const items = [{ id: 1, title: 'Voice 010', at: 3, dur: 5 }, { id: 2, title: 'voice 002', at: 1, dur: 50 }, { id: 3, title: 'Alpha', at: 2, dur: 1, rec: true }];
ok(M.sortItems(items, 'new').map((x) => x.id).join() === '3,1,2', 'newest first, the live recording on top');
ok(M.sortItems(items, 'az').map((x) => x.id).join() === '3,2,1', 'name A–Z with numbers in order');
ok(M.sortItems(items, 'long').map((x) => x.id).join() === '3,2,1', 'longest first');
ok(M.matches({ title: 'Team', text: [{ s: 'budget talk' }] }, 'BUDGET') && M.matches({ title: 'x', marks: [{ t: 1, name: 'Decision' }] }, 'decis') && !M.matches({ title: 'x' }, 'y'), 'search titles, text and bookmark names');

// ——— formatting ———
ok(M.fmtClock(0) === '00:00.00' && M.fmtClock(65.437) === '01:05.43' && M.fmtClock(3723.5) === '1:02:03.50', 'big timer');
ok(M.fmtLen(0) === '00:00' && M.fmtLen(59.6) === '01:00' && M.fmtLen(3725) === '1:02:05', 'lengths');
ok(M.fmtSize(500) === '1 KB' && M.fmtSize(2.5 * 1024 * 1024) === '2.50 MB', 'sizes');
ok(M.fileName('a/b:c?') === 'a b c' && M.extOf('audio/webm;codecs=opus') === 'webm' && M.extOf('audio/mp4') === 'm4a', 'file names');
ok(M.blobKey('id1') === 'recorder:id1' && M.isChunkOf(M.chunkKey('id1', 3), 'id1') && !M.isChunkOf(M.blobKey('id1'), 'id1'), 'blob keys');

console.log(`---- recorder-model: ${pass} passed, ${fail} failed ----`);
process.exit(fail ? 1 : 0);
