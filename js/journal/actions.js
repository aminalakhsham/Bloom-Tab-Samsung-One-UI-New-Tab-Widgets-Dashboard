// Journal's action for Modes and Routines ("Then"): New journal entry, with the text (or the previous action's result)
// in the default journal or a chosen one. Like Finder's "journal: …", it adds an entry even while Lock Journal is on:
// writing never shows what's already there. Runs in a page (the Journal's data helpers). Imported by js/apps/journal.js.
import { registerAction, RunError, toText } from '../routines/actions.js';
import { addStrings } from '../core/i18n.js';
import { store } from '../core/store.js';
import * as M from './model.js';
import { addEntry } from './data.js';

/** [value, label] pairs for a journal picker: '' (the default journal) and every journal (labels: names or i18n keys). */
export const journalChoices = (first = ['', 'journal.ra.defJournal']) => [first, ...M.norm(store.get(M.KEY)).journals.map((j) => [j.id, j.name || 'app.journal'])];

registerAction({
  id: 'journal.entry', name: 'journal.ra.entry', icon: 'jr-book', color: '#7b5cf0', cat: 'apps', out: 'journal.ra.out',
  params: [
    { key: 'text', type: 'text', label: 'journal.ra.text', input: true, multiline: true, ph: 'journal.ra.textPh' },
    // a getter, so journals made later are offered the next time the action's settings open
    { key: 'journal', type: 'enum', label: 'journal.ra.journal', def: '', get opts() { return journalChoices(); } },
  ],
  sub: (p, F) => F.text(p.text),
  run(ctx, p) {
    const text = toText(p.text ?? '').trim();
    if (!text) throw new RunError('routines.err.empty');
    addEntry({ text: text.slice(0, 20000), journal: p.journal || undefined });
    return text;
  },
});

addStrings({
  en: {
    'journal.ra.entry': 'New journal entry', 'journal.ra.text': 'Entry', 'journal.ra.textPh': 'What’s on your mind?', 'journal.ra.journal': 'Journal',
    'journal.ra.defJournal': 'Default journal', 'journal.ra.out': 'Journal entry',
    'journal.w.pickJournal': 'Journal to show', 'journal.w.allJournals': 'All journals',
  },
  ar: {
    'journal.ra.entry': 'إدخال جديد في اليوميات', 'journal.ra.text': 'الإدخال', 'journal.ra.textPh': 'بماذا تفكر؟', 'journal.ra.journal': 'اليوميات',
    'journal.ra.defJournal': 'اليوميات الافتراضية', 'journal.ra.out': 'إدخال اليوميات',
    'journal.w.pickJournal': 'اليوميات المعروضة', 'journal.w.allJournals': 'كل دفاتر اليوميات',
  },
});
