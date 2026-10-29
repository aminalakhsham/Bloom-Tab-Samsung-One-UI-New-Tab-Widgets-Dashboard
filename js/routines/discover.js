// Discover: ready-made routines in Samsung's style, grouped like the Discover page of Modes and Routines.
// Names and descriptions are i18n keys (js/routines/ui.js registers them); the routine copied into the user's list
// gets its name in their language. make() builds fresh actions each time (new ids). Pure, for the node test.
import { uid, ALL_DAYS } from './model.js';

const A = (type, p = {}, extra = {}) => ({ id: uid('a'), type, p, ...extra });
const WEEKDAYS = [1, 2, 3, 4, 5];

export const DISCOVER = [
  {
    id: 'sleep', name: 'routines.d.catSleep',
    items: [
      {
        id: 'bedtime', name: 'routines.d.bedtime', desc: 'routines.d.bedtimeDesc', icon: 'rtSleep', color: '#6f5cf1',
        make: () => ({ conds: [{ type: 'time', start: '22:30', end: '07:00', days: ALL_DAYS }], undo: true,
          actions: [A('theme.set', { value: 'dark' }), A('eye.set', { value: 'on', level: '60' }), A('brightness.set', { value: '50' }), A('focus.on', { min: '480' }), A('sound.play', { sound: 'brown' })] }),
      },
      {
        id: 'sunset', name: 'routines.d.sunset', desc: 'routines.d.sunsetDesc', icon: 'moon', color: '#a259e6',
        make: () => ({ conds: [{ type: 'time', start: 'sunset', end: 'sunrise', days: ALL_DAYS }], undo: true, actions: [A('theme.set', { value: 'dark' }), A('eye.set', { value: 'on', level: '40' })] }),
      },
      {
        id: 'winddown', name: 'routines.d.winddown', desc: 'routines.d.winddownDesc', icon: 'rtRelax', color: '#14b8a6',
        make: () => ({ conds: [{ type: 'manual' }], undo: true, actions: [A('mode.on', { mode: 'relax' }), A('tabs.mute', { value: 'mute' }), A('timer.start', { min: '20', label: '' })] }),
      },
    ],
  },
  {
    id: 'focus', name: 'routines.d.catFocus',
    items: [
      {
        id: 'workday', name: 'routines.d.workday', desc: 'routines.d.workdayDesc', icon: 'rtWork', color: '#c47a2c',
        make: () => ({ conds: [{ type: 'time', start: '09:00', end: '17:00', days: WEEKDAYS }], undo: true, actions: [A('mode.on', { mode: 'work' }), A('theme.set', { value: 'light' })] }),
      },
      {
        id: 'distraction', name: 'routines.d.distraction', desc: 'routines.d.distractionDesc', icon: 'rtBolt', color: '#f2556b',
        make: () => ({ conds: [{ type: 'site', hosts: ['youtube.com', 'x.com', 'instagram.com'] }], undo: false,
          actions: [A('notify', { title: 'routines.d.distractionTitle', text: 'routines.d.distractionText' })] }),
      },
      {
        id: 'break', name: 'routines.d.break', desc: 'routines.d.breakDesc', icon: 'rtCoffee', color: '#ff7a45',
        make: () => ({ conds: [{ type: 'manual' }], undo: false, actions: [A('timer.start', { min: '5', label: 'routines.d.breakLabel' }), A('sound.play', { sound: 'ocean' }), A('notify', { title: 'routines.d.break', text: 'routines.d.breakText' })] }),
      },
    ],
  },
  {
    id: 'day', name: 'routines.d.catDay',
    items: [
      {
        id: 'morning', name: 'routines.d.morning', desc: 'routines.d.morningDesc', icon: 'sun', color: '#f5a524',
        make: () => ({ conds: [{ type: 'startup' }], undo: false, actions: [A('theme.set', { value: 'light' }), A('brightness.set', { value: '100' }), A('notify', { title: 'routines.d.morning', text: 'routines.d.morningText' })] }),
      },
      {
        id: 'back', name: 'routines.d.back', desc: 'routines.d.backDesc', icon: 'rtIdle', color: '#3e7bff',
        make: () => ({ conds: [{ type: 'idle', away: 15 }], undo: false, actions: [A('focus.off'), A('notify', { title: 'routines.d.back', text: 'routines.d.backText' })] }),
      },
      {
        id: 'tidy', name: 'routines.d.tidy', desc: 'routines.d.tidyDesc', icon: 'rtTabsGroup', color: '#8a8d96',
        make: () => ({ conds: [{ type: 'manual' }], undo: false, actions: [A('tabs.group'), A('tabs.discard')] }),
      },
      {
        id: 'movie', name: 'routines.d.movie', desc: 'routines.d.movieDesc', icon: 'rtTheater', color: '#e2589c',
        make: () => {
          const ask = A('ask', { prompt: 'routines.d.movieAsk', kind: 'url' });
          return { conds: [{ type: 'manual' }], undo: true, actions: [ask, A('mode.on', { mode: 'theater' }), A('url.open', { urls: [{ v: ask.id }] })] };
        },
      },
    ],
  },
];
export const discoverItem = (id) => DISCOVER.flatMap((c) => c.items).find((x) => x.id === id);
