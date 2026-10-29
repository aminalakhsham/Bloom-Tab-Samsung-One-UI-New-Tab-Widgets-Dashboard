// Voice Recorder's actions for Modes and Routines ("Then"): Start recording (opens Voice Recorder and starts in the mode
// it was last in, like Finder's "record": the microphone is only ever used with the app on screen) and Stop recording
// (saves what's being recorded under its default name). Page-only: the service worker has no microphone. Imported by
// js/apps/recorder.js, which passes its quickStop().
import { registerAction, RunError } from '../routines/actions.js';
import { addStrings } from '../core/i18n.js';
import { openApp } from '../core/apps.js';
import { live } from './live.js';

export function registerRecorderActions({ stop }) {
  registerAction({
    id: 'recorder.start', name: 'recorder.ra.start', icon: 'mic', color: '#f4483f', cat: 'apps', params: [],
    run(ctx) {
      if (!ctx.page) throw new RunError('routines.err.page');
      if (live()) return;
      openApp('recorder', { params: { record: true } });
    },
  });
  registerAction({
    id: 'recorder.stop', name: 'recorder.ra.stop', icon: 'stop', color: '#f4483f', cat: 'apps', out: 'recorder.ra.out', params: [],
    async run(ctx) {
      if (!ctx.page) throw new RunError('routines.err.page');
      const r = live();
      if (!r) return '';
      const title = r.title;
      await stop();
      return title;
    },
  });
}

addStrings({
  en: { 'recorder.ra.start': 'Start recording', 'recorder.ra.stop': 'Stop recording', 'recorder.ra.out': 'Recording' },
  ar: { 'recorder.ra.start': 'بدء التسجيل', 'recorder.ra.stop': 'إيقاف التسجيل', 'recorder.ra.out': 'التسجيل' },
});
