// The Quick capture sheet (capture.html, shown over any website by js/bg/anytab.js), like Samsung Notes' quick note from
// Smart select: Note / Reminder / Journal / Log tabs, one text field that understands what you type (a reminder's date
// and time, "water 500 ml", "mood good", "took aspirin", "coffee 3.50 $"), the page attached as a link, and Save.
// It only ever writes: nothing saved before is shown, so it can open over any page even while the Lock screen is locked,
// and a locked Journal takes new entries without showing any.
//   const mods = await loadCaptureModules();   openCaptureSheet({ url, title, sel }, mods) → Promise<{ text } | null>
import { h, escapeHtml as esc, faviconUrl } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { dialog, seg, sw } from '../core/ui.js';
import { prettyUrl } from './page.js';
import { loadLog } from './log.js';

export const MODES = ['note', 'reminder', 'journal', 'log'];
const LS = 'bt.capture.mode';
const lsGet = () => { try { return localStorage.getItem(LS); } catch { return null; } };
const lsSet = (v) => { try { localStorage.setItem(LS, v); } catch {} };
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The app modules the sheet writes through; a mode whose module fails to load is left out. */
export async function loadCaptureModules() {
  const get = (p) => import(p).catch((e) => (console.warn('capture', p, e), null));
  const [notes, reminder, journal, jlock, log] = await Promise.all([
    get('../apps/notes.js'), get('../apps/reminder.js'), get('../journal/data.js'), get('../journal/lock.js'), loadLog().catch(() => null),
  ]);
  return {
    note: notes?.createNote ? notes : null,
    reminder: reminder?.addReminder && reminder.parseQuickTime ? reminder : null,
    journal: journal?.addEntry ? { addEntry: journal.addEntry, lockOn: jlock?.lockOn || (() => false) } : null,
    log: log && (log.health || log.wallet) ? log : null,
  };
}

const blocks = (text) => text.split('\n').map((l) => (l.trim() ? `<div>${esc(l)}</div>` : '<div><br></div>')).join('');
const linkLines = (link) => (link.title && link.title !== link.url ? [link.title, link.url] : [link.url]);

/** A note shaped like the ones js/apps/notes.js writes: the text as blocks, then the page's title and address. */
export function saveNote(mod, text, link) {
  text = text.replace(/\s+$/, '');
  if (!link) return mod.createNote({ body: blocks(text) });
  if (!text.trim()) return mod.createNote({ title: link.title && link.title !== link.url ? link.title.slice(0, 120) : '', body: blocks(link.url) });
  return mod.createNote({ body: blocks(text) + '<div><br></div>' + blocks(linkLines(link).join('\n')) });
}
/** A reminder through js/apps/reminder.js addReminder(): the typed time ("tomorrow 6pm") becomes its due time and its
 *  `reminder:<id>` alarm; the page goes in its notes (and `url`). */
export function saveReminder(mod, text, link) {
  const { title, due } = mod.parseQuickTime(text.trim());
  return mod.addReminder({ title: title || text.trim() || link?.title || link?.url || '', due: due || null, ...(link ? { notes: linkLines(link).join('\n'), url: link.url } : {}) });
}
export function saveJournal(mod, text, link) {
  text = text.replace(/\s+$/, '');
  return mod.addEntry({ text: link ? (text ? `${text}\n\n${linkLines(link).join('\n')}` : linkLines(link).join('\n')) : text });
}

export function openCaptureSheet(cap = {}, mods = {}) {
  const modes = MODES.filter((m) => mods[m]);
  const link = /^https?:/i.test(cap.url || '') ? { url: cap.url, title: String(cap.title || '').trim() } : null;
  let mode = modes.includes(lsGet()) ? lsGet() : modes[0];
  let intent = null, result = null;
  const sel = String(cap.sel || '').trim();

  const ta = h('textarea', { class: 'at-text', rows: 4, spellcheck: 'true', 'aria-label': t('anytab.capTitle') });
  const parse = h('div', { class: 'at-parse', 'aria-live': 'polite' });
  const attach = link ? sw(true, () => draw(), { label: t('anytab.attach') }) : null;
  // the page as a link card, like a web link in Samsung Notes; clicking the card flips its switch
  const linkCard = link ? h('div', { class: 'at-link', onClick: (e) => { if (!e.target.closest('.ou-switch')) { attach.input.checked = !attach.input.checked; draw(); } } },
    h('span', { class: 'at-fav' }, h('img', { src: faviconUrl(link.url, 32), alt: '' })),
    h('span', { class: 'at-link-t' }, h('bdi', { class: 'at-link-title' }, link.title || prettyUrl(link.url)), h('bdi', { class: 'at-link-url', dir: 'ltr' }, prettyUrl(link.url))),
    attach) : null;
  const foot = h('div', { class: 'at-cap-foot' }, h('span', { class: 'at-cap-note' }), h('span', { class: 'at-keys' }, t('anytab.keys', { key: (isMac ? '⌘' : 'Ctrl') + '+Enter' })));
  const tabs = seg(modes.map((v) => ({ value: v, label: t('anytab.mode.' + v) })), mode, (v) => {
    mode = v;
    lsSet(v);
    draw();
    ta.focus();
  });
  tabs.classList.add('at-modes');
  const content = h('div', { class: 'at-cap' }, tabs, h('div', { class: 'at-card' }, ta, parse), linkCard, foot);
  // a selection comes in quoted, like a highlight added to a note; a reminder or a log takes its first line as it is
  if (sel) ta.value = mode === 'note' || mode === 'journal' ? `“${sel}”\n` : sel.split('\n')[0];

  const done = dialog({
    title: t('anytab.capTitle'),
    content,
    className: 'at-sheet at-cap-sheet',
    actions: [
      { label: t('common.cancel'), value: null },
      { label: t('common.save'), primary: true, validate: () => !!(result = save()), value: () => result },
    ],
  });
  const box = content.closest('.ou-dialog');
  const saveBtn = box.querySelector('.ou-dialog-btn.primary');
  const linked = () => !!link && mode !== 'log' && (!attach || attach.input.checked);

  const chip = (ic, text, cls = '') => h('span', { class: ['at-chip', cls] }, ic ? h('span', { html: icon(ic, 14) }) : null, h('bdi', null, text));
  function draw() {
    content.dataset.mode = mode;
    ta.placeholder = t('anytab.ph.' + mode);
    linkCard?.toggleAttribute('hidden', mode === 'log');
    const text = ta.value.trim();
    let ok = !!text || linked(), kids = [], note = null;
    intent = null;
    if (mode === 'reminder' && text) {
      const p = mods.reminder.parseQuickTime(text);
      kids = [h('div', { class: 'at-chips' }, chip('', p.title || text, 'title'), p.due ? chip('calendar', mods.reminder.fmtDue(p.due)) : chip('bellOff', t('anytab.noAlert'), 'muted'))];
    } else if (mode === 'journal' && mods.journal.lockOn()) {
      note = [h('span', { html: icon('lock', 14) }), h('span', null, t('anytab.journalLocked'))];
    } else if (mode === 'log') {
      intent = text ? mods.log.understand(text) : null;
      const d = intent && mods.log.describe(intent);
      ok = !!d?.ok;
      kids = d
        ? [h('div', { class: ['at-log', !d.ok && 'off'] },
          h('span', { class: 'at-log-ico', style: { background: d.color }, html: icon(d.icon, 20) }),
          h('span', { class: 'at-log-t' }, h('b', null, h('bdi', null, d.title)), h('small', null, h('bdi', null, d.sub)))),
        d.pick ? h('div', { class: 'at-moods' }, ['great', 'good', 'okay', 'bad', 'awful'].map((id) =>
          h('button', { class: 'at-mood', style: { '--mc': mods.log.MOOD_COLORS[id] }, dataset: { mood: id }, onClick: () => pickMood(id) },
            h('span', { class: 'at-mood-dot', html: icon('at-m-' + id, 24) }), h('span', null, mods.log.moodName(id))))) : null]
        : [h('div', { class: 'at-try' }, t('anytab.log.try'))];
    }
    parse.replaceChildren(...kids.filter(Boolean));
    parse.hidden = !kids.length;
    foot.firstChild.replaceChildren(...(note || []));
    saveBtn.disabled = !ok;
    // the field grows with the text, up to 40% of the window
    ta.rows = mode === 'reminder' || mode === 'log' ? 2 : 4;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, Math.max(120, innerHeight * 0.4)) + 'px';
  }

  function save() {
    if (saveBtn.disabled) return null;
    const text = ta.value, l = linked() ? link : null;
    try {
      if (mode === 'note') return saveNote(mods.note, text, l) && { text: t('anytab.saved.note') };
      if (mode === 'reminder') {
        const r = saveReminder(mods.reminder, text, l);
        return r && { text: r.due ? t('anytab.saved.reminderAt', { when: mods.reminder.fmtDue(r.due) }) : t('anytab.saved.reminder') };
      }
      if (mode === 'journal') return saveJournal(mods.journal, text, l) && { text: t(mods.journal.lockOn() ? 'anytab.saved.journalLocked' : 'anytab.saved.journal') };
      if (mode === 'log' && intent) return mods.log.save(intent);
    } catch (e) {
      console.warn('capture', e);
    }
    return null;
  }
  function pickMood(id) {
    const r = mods.log.save({ kind: 'mood', mood: id });
    if (r) box._close(r);
  }

  ta.addEventListener('input', draw);
  ta.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    // Ctrl/⌘+Enter saves anywhere; Enter alone saves a reminder or a log, which are one line
    if (e.metaKey || e.ctrlKey || ((mode === 'reminder' || mode === 'log') && !e.shiftKey)) {
      e.preventDefault();
      saveBtn.click();
    }
  });
  // Alt plus a mode's first letter switches to it (N, R, J, L), so the keyboard alone does everything
  box.addEventListener('keydown', (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey) return;
    const m = { KeyN: 'note', KeyR: 'reminder', KeyJ: 'journal', KeyL: 'log' }[e.code];
    if (!m || !modes.includes(m)) return;
    e.preventDefault();
    mode = m;
    lsSet(m);
    tabs.set(m);
    draw();
  });
  draw();
  setTimeout(() => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, 90);
  return done;
}
