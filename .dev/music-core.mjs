// Samsung Music player rules in plain node (js/music/core.js): queue, next/previous, shuffle, repeat, Play next,
// remove/move, pruning deleted tracks, crossfade target, equaliser, lyrics. usage: node .dev/music-core.mjs
import {
  MDEF, withDefaults, goTo, nextPatch, prevPatch, queueFor, shufflePatch, nextRepeat, playNextPatch, appendPatch, removePatch,
  movePatch, prunePatch, upNext, eqGains, EQ_BANDS, parseLyrics, plainLyrics, lineAt, fmtDur, matchScore, cmp, sleepLeft,
} from '../js/music/core.js';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ok', m)) : (fail++, console.log('FAIL', m)));
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (${JSON.stringify(a)})`);

const lib = Object.fromEntries('abcdef'.split('').map((id, i) => [id, { id, title: 'T' + id, artist: 'A', album: 'X', dur: 100 + i }]));
const lookup = (id) => lib[id];
const apply = (m, p) => ({ ...m, ...p });
let m = withDefaults({ queue: ['a', 'b', 'c'], index: 0, playing: true });

// next / previous / end of queue
let p = nextPatch(m, lookup);
eq([p.index, p.now.id, p.seek.pos, p.seek.id], [1, 'b', 0, 'b'], 'next moves on and seeks to 0');
m = apply(m, p);
eq(prevPatch(m, lookup, 10).index, 1, 'previous after 3 s restarts the track');
eq(prevPatch(m, lookup, 1).index, 0, 'previous within 3 s goes back');
m = apply(m, { index: 2 });
ok(nextPatch(m, lookup, true).end, 'end of queue with repeat off');
eq(nextPatch({ ...m, repeat: 'all' }, lookup, true).index, 0, 'repeat all wraps around');
ok(nextPatch({ ...m, repeat: 'one' }, lookup, true).end, 'repeat 1 at the end: the player loops the track itself');
eq(nextPatch({ ...m, repeat: 'one' }, lookup, false).index, 0, 'Next button with repeat 1 still moves on');
eq([nextRepeat('off'), nextRepeat('all'), nextRepeat('one')], ['all', 'one', 'off'], 'repeat cycles off → all → 1 → off');

// crossfade target
eq(upNext({ ...m, index: 1 }), 'c', 'crossfade into the next track');
eq(upNext({ ...m, index: 2 }), null, 'no crossfade at the end of the queue');
eq(upNext({ ...m, index: 2, repeat: 'all' }), 'a', 'crossfade wraps with repeat all');
eq(upNext({ ...m, index: 0, repeat: 'one' }), null, 'no crossfade with repeat 1');
eq(upNext({ ...m, index: 0, sleepEnd: 'a' }), null, 'no crossfade when the sleep timer stops after this track');

// queue building and shuffle
const seq = (() => {
  let s = 7;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
})();
eq(queueFor(['a', 'b', 'c'], 1), { queue: ['a', 'b', 'c'], index: 1, order: null, shuffle: false }, 'plain queue starts at the chosen track');
const q = queueFor(['a', 'b', 'c', 'd', 'e'], 2, true, seq);
ok(q.queue[0] === 'c' && q.index === 0 && q.queue.length === 5 && new Set(q.queue).size === 5, 'shuffled queue plays the chosen track first');
const q2 = queueFor(['a', 'b', 'c', 'd'], -1, true, seq);
ok(q2.queue.length === 4 && new Set(q2.queue).size === 4, 'shuffle all keeps every track once');
m = withDefaults({ queue: ['a', 'b', 'c', 'd', 'e', 'f'], index: 1, playing: true });
const sh = shufflePatch(m, true, seq);
ok(sh.shuffle && sh.queue.slice(0, 2).join() === 'a,b' && new Set(sh.queue).size === 6, 'shuffle on keeps played tracks and the current one');
const un = shufflePatch({ ...m, ...sh }, false);
eq(un.queue, ['a', 'b', 'c', 'd', 'e', 'f'], 'shuffle off restores the original order');

// Play next / add to queue / remove / move
m = withDefaults({ queue: ['a', 'b', 'c'], index: 0, playing: true });
m = apply(m, playNextPatch(m, ['x']));
m = apply(m, playNextPatch(m, ['y']));
eq([m.queue, m.user], [['a', 'x', 'y', 'b', 'c'], 2], 'Play next goes after earlier Play next tracks');
m = apply(m, appendPatch(m, ['z']));
eq(m.queue.at(-1), 'z', 'Add to queue appends');
eq(removePatch(m, 0), null, 'the current track cannot be removed');
const r1 = removePatch(m, 1);
eq([r1.queue.join(''), r1.index, r1.user], ['aybcz', 0, 1], 'removing a Play next track');
m = withDefaults({ queue: ['a', 'b', 'c', 'd'], index: 2 });
const r2 = removePatch(m, 0);
eq([r2.queue.join(''), r2.index], ['bcd', 1], 'removing an earlier track keeps the current one');
eq(movePatch(m, 2, 0), { queue: ['c', 'a', 'b', 'd'], index: 0, user: 0 }, 'moving the current track');
eq(movePatch(m, 0, 3).index, 1, 'moving an earlier track past the current one');
eq(movePatch(m, 3, 0).index, 3, 'moving a later track before the current one');
eq(movePatch(m, 1, 1), null, 'moving onto itself does nothing');

// deleted tracks
m = withDefaults({ queue: ['a', 'b', 'c', 'd'], index: 2, playing: true, now: { id: 'c' } });
const alive = (id) => id !== 'b';
const pr = prunePatch(m, alive, lookup);
eq([pr.queue.join(''), pr.index, pr.now.id], ['acd', 1, 'c'], 'deleting an earlier track keeps playing');
const pr2 = prunePatch(m, (id) => id !== 'c', lookup);
eq([pr2.queue.join(''), pr2.index, pr2.playing, pr2.now.id], ['abd', 2, false, 'd'], 'deleting the current track stops on the next one');
eq(prunePatch(m, () => false, lookup).queue, [], 'deleting everything empties the queue');
eq(prunePatch(m, () => true, lookup), null, 'nothing deleted, nothing to do');
eq(goTo(m, 0, lookup, false).playing, false, 'goTo can land paused');

// equaliser
eq(eqGains({ eq: 'normal' }), [0, 0, 0, 0, 0, 0, 0, 0, 0], 'Normal is flat');
eq(eqGains({ eq: 'custom', eqCustom: [20, -20, 3.4] }).slice(0, 4), [10, -10, 3, 0], 'Custom bands are clamped to ±10 dB');
eq(eqGains({ eq: 'nope' }).length, EQ_BANDS.length, 'unknown preset falls back to flat');
eq(EQ_BANDS.length, 9, 'nine bands like One UI');

// lyrics
const lrc = '[ti:Song]\n[offset:+500]\n[00:01.00]One\n[00:03.50][00:10.00]Two\nplain line';
const lines = parseLyrics(lrc);
eq(lines.map((l) => [l.t, l.text]), [[0.5, 'One'], [3, 'Two'], [9.5, 'Two']], 'LRC with offset and repeated stamps');
eq([lineAt(lines, 0), lineAt(lines, 0.6), lineAt(lines, 5), lineAt(lines, 99)], [-1, 0, 1, 2], 'line at a time');
eq(parseLyrics('just words\nmore words'), null, 'plain lyrics are not synced');
eq(plainLyrics(lrc), 'One\nTwo\nplain line', 'plain text from LRC');

// formatting, search, sleep timer
eq([fmtDur(0), fmtDur(65), fmtDur(3725)], ['0:00', '1:05', '1:02:05'], 'durations');
eq([matchScore('Paper Boats', 'paper boats'), matchScore('Paper Boats', 'pap'), matchScore('Paper Boats', 'boa'), matchScore('Paper Boats', 'per'), matchScore('Paper Boats', 'xyz')], [3, 2, 1, 0.5, 0], 'match scores');
ok(cmp('The Beatles', 'Abba') > 0 && cmp('the beatles', 'Beatles') === 0, 'sorting ignores "The" and case');
eq([sleepLeft({ sleepAt: 0 }), sleepLeft({ sleepAt: 1000 + 90e3 }, 1000)], [0, 2], 'sleep timer minutes left');
eq(Object.keys(MDEF).includes('crossfade') && MDEF.speed, 1, 'defaults');

console.log(`---- ${pass} passed, ${fail} failed ----`);
process.exit(fail ? 1 : 0);
