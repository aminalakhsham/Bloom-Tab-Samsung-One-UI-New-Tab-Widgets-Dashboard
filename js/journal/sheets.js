// Journal dialogs and shared cards: suggestion cards (a reflection prompt and moments from your day), the suggestion
// picker, the date picker, New/Edit journal, and export as text or Markdown.
import { h, download } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtDate, fmtTime } from '../core/i18n.js';
import { dialog, choose, swatches, toast } from '../core/ui.js';
import * as M from './model.js';
import { D } from './data.js';
import { moments, recommended, momentOf, kindInfo } from './suggestions.js';
import { promptText } from './prompts.js';
import { journalName, dayLabel } from './common.js';
import { moodName } from './mood.js';

// ------------------------------------------------------------------ suggestion cards
/** The day's reflection prompt as a card: tap to write, ↻ for another one. */
export function promptCard(onPick, n = 0) {
  let k = M.promptKey(Date.now(), n);
  const q = h('p', { class: 'jr-sg-q' }, promptText(k));
  const card = h('div', { class: 'jr-sg jr-sg-prompt', role: 'button', tabindex: 0, dataset: { prompt: k }, onClick: (e) => !e.target.closest('.jr-sg-next') && onPick({ prompt: k }), onKeydown: (e) => e.key === 'Enter' && e.target === card && onPick({ prompt: k }) },
    h('span', { class: 'jr-sg-lab' }, h('span', { html: icon('sparkle', 14) }), t('journal.reflection')),
    q,
    h('span', { class: 'jr-sg-acts' },
      h('span', { class: 'jr-sg-write' }, h('span', { html: icon('edit', 14) }), t('journal.write')),
      h('button', { class: 'jr-sg-next', title: t('journal.anotherPrompt'), 'aria-label': t('journal.anotherPrompt'), html: icon('refresh', 16), onClick: (e) => { e.stopPropagation(); k = M.promptKey(Date.now(), ++n); card.dataset.prompt = k; q.textContent = promptText(k); } })));
  return card;
}
/** A moment (event, finished reminders, Focus, a note, music) as a card. */
export function momentCard(m, onPick) {
  const k = kindInfo(m.kind);
  return h('button', { class: 'jr-sg jr-sg-mo', style: { '--mc': m.color || k.color }, dataset: { kind: m.kind }, onClick: () => onPick({ moment: momentOf(m) }) },
    h('span', { class: 'jr-sg-ico', html: icon(k.icon, 18) }),
    h('span', { class: 'jr-sg-txt' }, h('b', null, m.title), m.sub ? h('small', null, m.sub) : null),
    m.list?.length > 1 ? h('span', { class: 'jr-sg-list' }, m.list.slice(0, 3).map((s) => h('span', null, s))) : null,
    h('em', { class: 'jr-sg-when' }, `${k.name()} · ${dayLabel(m.at)}`));
}
/** Recommended suggestions for the strip on the entries list (prompt first). */
export function suggestionCards(onPick, { limit = 5 } = {}) {
  const off = D().prefs.off;
  const out = [];
  if (!off.includes('prompts')) out.push(promptCard(onPick));
  for (const m of recommended(moments({ off }), limit)) out.push(momentCard(m, onPick));
  return out;
}

/** The suggestions as a sheet (from the editor): pick one to attach. Resolves { moment } / { prompt } or null. */
export function pickSuggestion() {
  let done;
  const pick = (v) => {
    done = v;
    box.closest('.ou-dialog')?._close(v);
  };
  const off = D().prefs.off;
  const list = moments({ off });
  const box = h('div', { class: 'jr-sgsheet' },
    off.includes('prompts') ? null : promptCard(pick),
    ...list.map((m) => momentCard(m, pick)),
    !list.length ? h('p', { class: 'jr-sg-none' }, t('journal.noMoments')) : null);
  return dialog({ title: t('journal.suggestions'), className: 'jr-sg-dlg', content: box, actions: [{ label: t('common.cancel'), value: null }] }).then((v) => v || done || null);
}

// ------------------------------------------------------------------ date and time
/** Edit date: a date and a time. Resolves the new time (ms) or null. */
export function editDate(at) {
  const x = new Date(at), pad = (n) => String(n).padStart(2, '0');
  const di = h('input', { class: 'ou-input', type: 'date', value: `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`, 'aria-label': t('journal.date') });
  const ti = h('input', { class: 'ou-input', type: 'time', value: `${pad(x.getHours())}:${pad(x.getMinutes())}`, 'aria-label': t('journal.time') });
  return dialog({
    title: t('journal.editDate'),
    content: h('div', { class: 'ou-dialog-body jr-date-dlg' }, di, ti),
    actions: [
      { label: t('common.cancel'), value: null },
      { label: t('common.done'), primary: true, value: () => {
        const [y, m, dd] = di.value.split('-').map(Number), [hh, mi] = (ti.value || '00:00').split(':').map(Number);
        return y ? +new Date(y, m - 1, dd, hh || 0, mi || 0) : null;
      } },
    ],
  });
}

// ------------------------------------------------------------------ journals
/** New journal / Edit journal: a name and a colour. Resolves { name, color }, 'delete', or null. */
export function journalDialog(j, { isNew = false, canDelete = false } = {}) {
  let color = j?.color || M.COLORS[(D().journals.length + 1) % M.COLORS.length];
  const name = h('input', { class: 'ou-input', placeholder: t('journal.journalName'), value: isNew ? '' : journalName(j), maxlength: 40, 'aria-label': t('journal.journalName') });
  const actions = [];
  if (canDelete) actions.push({ label: t('common.delete'), value: 'delete', danger: true });
  actions.push({ label: t('common.cancel'), value: null }, {
    label: isNew ? t('common.add') : t('common.save'),
    primary: true,
    validate: () => !!name.value.trim() || (name.focus(), false),
    value: () => ({ name: !isNew && !j.name && name.value.trim() === journalName({ name: '' }) ? '' : name.value.trim(), color }),
  });
  return dialog({
    title: isNew ? t('journal.newJournal') : t('journal.editJournal'),
    content: h('div', { class: 'ou-dialog-body' }, name, h('div', { class: 'jr-dlg-label' }, t('journal.color')), swatches(M.COLORS, color, (c) => (color = c))),
    actions,
  });
}

// ------------------------------------------------------------------ export
/** Asks for a format and downloads the entries as one text or Markdown file. */
export async function exportEntries(list, name = t('app.journal')) {
  if (!list.length) return toast(t('journal.nothingToExport'));
  const fmt = await choose(t('journal.exportAs'), [{ value: 'md', label: t('journal.markdown'), sub: '.md' }, { value: 'txt', label: t('journal.plainText'), sub: '.txt' }], 'md');
  if (!fmt) return;
  const d = D();
  const doc = M.exportDoc(list, fmt, {
    title: name,
    date: (ms) => `${fmtDate(new Date(ms), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${fmtTime(new Date(ms))}`,
    mood: (l) => moodName(l),
    journal: (e) => (d.journals.length > 1 ? journalName(M.journalById(d, M.journalOf(d, e))) : ''),
    prompt: (k) => promptText(k),
  });
  const file = String(name).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) + (fmt === 'md' ? '.md' : '.txt');
  download(file, doc, fmt === 'md' ? 'text/markdown' : 'text/plain');
  toast(t('journal.exported'));
}
