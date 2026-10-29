// Clock's actions for Modes and Routines: Start timer (with the timer sound) and Set alarm. Both run in the service
// worker too (sw: true), so js/bg/clock.js imports this module as well as the pages (lazily, from js/apps/clock.js).
// Start timer keeps the id and parameters of the Routines' built-in one it replaces, so saved routines keep working.
// Pure: no DOM.
import { registerAction, RunError, toNumber, toText } from '../routines/actions.js';
import { nextAlarmTime } from '../core/schedule.js';
import { newTimer, newAlarm, parseAlarmTime } from './core.js';
import { TONES } from './tones.js';

const P = (key, type, label, o = {}) => ({ key, type, label, ...o });
const clean = (n) => (Number.isFinite(n) ? +n.toPrecision(12) : n);
const SOUNDS = [['', 'clock.timerSoundDefault'], ...TONES.map((id) => [id, 'clock.tone.' + id])];
const REPEATS = { once: [], daily: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] };

registerAction({
  id: 'timer.start', name: 'routines.a.timer', icon: 'timer', color: '#ff7a45', cat: 'apps', sw: true,
  params: [P('min', 'number', 'routines.p.minutes', { def: '5' }), P('label', 'text', 'routines.p.label', { ph: 'routines.p.label' }),
    P('sound', 'enum', 'clock.timerSound', { opts: SOUNDS, def: '' })],
  sub: (p, F) => F.t('routines.v.min', { n: clean(toNumber(p.min ?? 5)) }) + (F.text(p.label) ? ' · ' + F.text(p.label) : ''),
  async run(ctx, p) {
    const ms = Math.round(toNumber(p.min) * 60e3);
    if (!(ms >= 1000)) throw new RunError('routines.err.duration');
    // the same timer shape and alarm as the Clock app and Finder's "timer 5m"
    const x = newTimer(ms, { label: toText(p.label ?? '').trim(), sound: TONES.includes(p.sound) ? p.sound : '' });
    await ctx.set('timers', [...((await ctx.get('timers')) || []), x]);
    ctx.schedule('timer:' + x.id, x.endsAt);
  },
});

registerAction({
  id: 'clock.alarm', name: 'clock.ra.alarm', icon: 'alarm', color: '#3b4bd6', cat: 'apps', sw: true,
  params: [P('time', 'text', 'clock.ra.time', { def: '07:00', ph: 'clock.ra.timePh' }), P('label', 'text', 'clock.alarmName', { ph: 'clock.alarmName' }),
    P('repeat', 'enum', 'clock.repeat', { opts: [['once', 'clock.ra.once'], ['daily', 'clock.everyDay'], ['weekdays', 'clock.weekdays'], ['weekends', 'clock.weekends']], def: 'once' })],
  sub: (p, F) => F.text(p.time) + (p.repeat && p.repeat !== 'once' ? ' · ' + F.opt('clock.alarm', 'repeat', p.repeat) : '') + (F.text(p.label) ? ' · ' + F.text(p.label) : ''),
  async run(ctx, p) {
    const time = parseAlarmTime(toText(p.time));
    if (!time) throw new RunError('clock.err.time', { text: toText(p.time) });
    const a = newAlarm({ time, label: toText(p.label ?? '').trim(), days: [...(REPEATS[p.repeat] || [])] });
    await ctx.set('alarms', [...((await ctx.get('alarms')) || []), a]);
    ctx.schedule('alarm:' + a.id, nextAlarmTime(a));
    return time;
  },
});
