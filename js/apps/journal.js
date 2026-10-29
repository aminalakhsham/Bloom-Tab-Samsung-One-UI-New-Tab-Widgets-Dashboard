// Journal — a first-party One UI journaling app (Samsung has none, so it borrows Samsung Notes' and Samsung Health's
// look): entries with photos, drawings, mood and tags in journals, a calendar, Insights, suggestions made from your day
// and Lock Journal. This file only registers the app, its widgets, Finder command/search and lock widget; the UI
// (js/journal/ui.js) loads when the app opens.
import { h } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerCommand, registerLockWidget } from '../core/hooks.js';
import { store } from '../core/store.js';
import { addStrings, t, fmtDate, fmtTime } from '../core/i18n.js';
import { toast, choose } from '../core/ui.js';
import { blobUrl } from '../core/blobs.js';
import * as M from '../journal/model.js';
import { D, addEntry, searchEntries, pl } from '../journal/data.js';
import { lockOn, lockNeeded } from '../journal/lock.js';
import { journalChoices } from '../journal/actions.js'; // also Modes and Routines: New journal entry

const GLYPH = '<path d="M7 3.6h10.3A1.7 1.7 0 0 1 19 5.3v13.4a1.7 1.7 0 0 1-1.7 1.7H7a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2Z"/><path d="M8.6 3.6v16.8"/><path d="M12.2 3.6v6.2l1.7-1.3 1.7 1.3V3.6"/>';
addIcons({
  'jr-book': GLYPH,
  'jr-flame': '<path d="M12 21c-3.7 0-6.5-2.7-6.5-6.3 0-2.6 1.4-4.5 3-6.1.4 1.6 1.2 2.7 2.4 3.2-.4-3.6 1.3-6.5 3.8-8.3.1 2.7 1.2 4.3 2.6 5.9 1.1 1.3 1.5 2.9 1.5 4.6C18.8 18.2 15.8 21 12 21Z"/>',
  'jr-smile': '<circle cx="12" cy="12" r="8.5"/><path d="M8.6 14.2a4.1 4.1 0 0 0 6.8 0"/><circle cx="9.3" cy="10" r=".9" fill="currentColor" stroke="none"/><circle cx="14.7" cy="10" r=".9" fill="currentColor" stroke="none"/>',
  'jr-tag': '<path d="M3.5 11.6V5A1.5 1.5 0 0 1 5 3.5h6.6l9 9a1.5 1.5 0 0 1 0 2.1l-6 6a1.5 1.5 0 0 1-2.1 0l-9-9Z"/><circle cx="8" cy="8" r="1.4"/>',
  'jr-nib': '<path d="M12 3.5 6.5 9l1.8 8.6L12 21l3.7-3.4L17.5 9 12 3.5Z"/><path d="M12 3.5v8.2"/><circle cx="12" cy="13" r="1.3"/>',
  'jr-format': '<path d="M3 18 7.5 6h1L13 18M4.6 14h5.8"/><path d="M15.6 12.1c.6-.8 1.5-1.2 2.5-1.2 1.6 0 2.4.9 2.4 2.4V18m0-3.2c-.7-.4-1.4-.5-2.2-.5-1.6 0-2.7.7-2.7 1.9 0 1 .8 1.8 2.1 1.8 1.2 0 2.2-.6 2.8-1.5"/>',
  'jr-numlist': '<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M4.3 5.2 5.6 4.5v4M4.3 8.5h2.6M4.3 14.2c.2-.6.7-.9 1.3-.9.7 0 1.2.4 1.2 1 0 1.1-2.6 1.8-2.6 3.2h2.7"/>',
  'jr-chart': '<path d="M5.5 19.5v-8M10.5 19.5v-14M15.5 19.5v-6M20.5 19.5v-10"/>',
  'jr-bookmark-fill': '<path d="M6.5 3.5h11V20.5L12 16.5l-5.5 4V3.5Z" fill="currentColor"/>',
  'jr-eraser': '<path d="m14.4 4.6 5 5-8.9 8.9H6.1l-2.6-2.6a1.5 1.5 0 0 1 0-2.1l10.9-9.2Z"/><path d="M10.5 18.5H20M9 10.2l4.8 4.8"/>',
  'jr-undo': '<path d="M9 6.5 4.5 11 9 15.5"/><path d="M5 11h9.5a5 5 0 0 1 0 10H12"/>',
  'jr-backspace': '<path d="M8.5 5.5h11A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5h-11L3 12l5.5-6.5Z"/><path d="m11.5 9.5 5 5M16.5 9.5l-5 5"/>',
});

addStrings({
  en: {
    'app.journal': 'Journal',
    'journal.wJournal': 'Journal',
    'journal.wRecent': 'Journal entry',
    'journal.lockWidget': 'Journal streak',
    'journal.streak': 'Streak',
    'journal.daysInRow': 'days in a row|day in a row',
    'journal.dayStreak': '{n}-day streak|{n}-day streak',
    'journal.wroteToday': 'You wrote today',
    'journal.keepGoing': 'Write today to keep it going',
    'journal.reflection': 'Reflection',
    'journal.write': 'Write',
    'journal.locked': 'Journal is locked',
    'journal.lockedSub': 'Open Journal to see your entries',
    'journal.noEntries': 'No entries yet',
    'journal.startHint': 'Write about your day',
    'journal.cmd': 'Add to Journal',
    'journal.saved': 'Saved to Journal',
    'journal.savedLocked': 'Saved to Journal. It stays locked.',
  },
  ar: {
    'app.journal': 'اليوميات',
    'journal.wJournal': 'اليوميات',
    'journal.wRecent': 'إدخال اليوميات',
    'journal.lockWidget': 'سلسلة اليوميات',
    'journal.streak': 'السلسلة',
    'journal.daysInRow': 'يوم متتالٍ|يوم متتالٍ|يومان متتاليان|أيام متتالية|يومًا متتاليًا|يوم متتالٍ',
    'journal.dayStreak': 'سلسلة {n} يوم|سلسلة يوم واحد|سلسلة يومين|سلسلة {n} أيام|سلسلة {n} يومًا|لا توجد سلسلة',
    'journal.wroteToday': 'كتبت اليوم',
    'journal.keepGoing': 'اكتب اليوم لمواصلة السلسلة',
    'journal.reflection': 'تأمّل',
    'journal.write': 'كتابة',
    'journal.locked': 'اليوميات مقفلة',
    'journal.lockedSub': 'افتح اليوميات لعرض إدخالاتك',
    'journal.noEntries': 'لا توجد إدخالات بعد',
    'journal.startHint': 'اكتب عن يومك',
    'journal.cmd': 'إضافة إلى اليوميات',
    'journal.saved': 'تم الحفظ في اليوميات',
    'journal.savedLocked': 'تم الحفظ في اليوميات. وتبقى مقفلة.',
  },
});

const dayLabel = (ms) => {
  const k = M.dayKey(ms), now = Date.now();
  if (k === M.dayKey(now)) return t('common.today');
  if (k === M.addDays(M.dayKey(now), -1)) return t('common.yesterday');
  return fmtDate(new Date(ms), new Date(ms).getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
};
const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';

registerApp({
  id: 'journal',
  name: 'app.journal',
  icon: { bg: 'linear-gradient(145deg, #9d86ff 0%, #6a4be0 55%, #5a36c9 100%)', glyph: GLYPH },
  keywords: ['journal', 'diary', 'mood', 'entries', 'يوميات', 'مذكرات', 'مزاج'],
  render: (ctx) => import('../journal/ui.js').then((m) => m.render(ctx)),
  // A locked journal gives nothing, so its words never show outside the app.
  search(q) {
    if (lockNeeded()) return [];
    return searchEntries(q, 5).map((e) => ({
      title: e.title || firstLine(e.text) || dayLabel(e.at),
      sub: [dayLabel(e.at), e.title ? firstLine(e.text) : ''].filter(Boolean).join(' · ').slice(0, 90),
      icon: 'jr-book',
      onOpen: () => openApp('journal', { params: { id: e.id } }),
    }));
  },
});

// ——— Finder: "journal: <text>" saves a quick entry (a locked journal still takes new entries) ———
registerCommand('journal', (q, lower, done) => {
  const m = q.match(/^(?:journal|diary|يوميات|اليوميات|مذكرات)\s*[:：]\s*([\s\S]+)$/i);
  const text = m?.[1]?.trim();
  if (!text) return [];
  return [{
    icon: 'jr-book',
    title: t('journal.cmd'),
    sub: text,
    run: () => {
      addEntry({ text });
      toast(lockOn() ? t('journal.savedLocked') : t('journal.saved'));
      done?.();
    },
  }];
});

// ——— Lock screen: the streak (only the flame and the number while locked) ———
registerLockWidget('journal', {
  name: 'journal.lockWidget',
  render: async ({ locked } = {}) => {
    const st = M.streak(D());
    if (!st.current) return null;
    return h('span', { class: 'lk-w jr-lkw' }, h('span', { class: 'jr-lkw-ico', html: icon('jr-flame', 18) }), locked ? String(st.current) : pl('journal.dayStreak', st.current));
  },
});

// ——— widgets ———
function weekDots(d) {
  const days = M.daysWith(d), today = M.dayKey(Date.now());
  return h('div', { class: 'jrw-week' }, Array.from({ length: 7 }, (_, i) => {
    const k = M.addDays(today, i - 6);
    return h('span', { class: ['jrw-dot', days.has(k) && 'on', k === today && 'today'], title: fmtDate(M.keyDate(k), { weekday: 'long' }) },
      fmtDate(M.keyDate(k), { weekday: 'narrow' }));
  }));
}

registerWidget({
  id: 'journal',
  name: 'journal.wJournal',
  sizes: ['s', 'm'],
  defaultSize: 'm',
  app: 'journal',
  onClick: (item, el) => openApp('journal', { from: el, params: { section: item.size === 's' ? 'insights' : 'entries' } }),
  render(el, { size }) {
    el.classList.add('jrw', 'jrw-journal');
    const draw = async () => {
      const d = D(), st = M.streak(d);
      const streakBox = h('div', { class: 'jrw-streak' },
        h('div', { class: 'jrw-head' }, h('span', { class: 'jrw-flame', html: icon('jr-flame', 16) }), t('journal.streak')),
        h('div', { class: 'jrw-num' }, h('b', null, String(st.current)), h('span', null, pl('journal.daysInRow', st.current))),
        h('div', { class: 'jrw-sub' }, st.today ? t('journal.wroteToday') : t('journal.keepGoing')),
        weekDots(d));
      if (size === 's') return el.replaceChildren(streakBox);
      const { promptText } = await import('../journal/prompts.js');
      const key = M.promptKey(Date.now());
      el.replaceChildren(h('div', { class: 'jrw-split' },
        h('div', { class: 'jrw-prompt' },
          h('div', { class: 'jrw-head' }, h('span', { class: 'jrw-book', html: icon('jr-book', 16) }), t('journal.reflection')),
          h('div', { class: 'jrw-q' }, promptText(key)),
          h('button', {
            class: 'jrw-write',
            onClick: (e) => {
              e.stopPropagation();
              openApp('journal', { from: el, params: { section: 'new', prompt: key } });
            },
          }, h('span', { html: icon('edit', 16) }), t('journal.write'))),
        streakBox));
    };
    draw();
    const offs = [store.on(M.KEY, draw)];
    // the prompt and the week change at midnight
    const tm = setInterval(() => new Date().getHours() === 0 && draw(), 60e3 * 10);
    return () => {
      offs.forEach((f) => f());
      clearInterval(tm);
    };
  },
});

/** The newest live entry, of the widget's journal when it has one (a deleted journal falls back to every journal). */
function newest(config) {
  const d = D(), j = config?.journal && M.journalById(d, config.journal) ? config.journal : '';
  return M.sorted(M.live(d).filter((e) => !j || M.journalOf(d, e) === j))[0] || null;
}
registerWidget({
  id: 'journal-recent',
  name: 'journal.wRecent',
  sizes: ['s', 'm'],
  defaultSize: 's',
  app: 'journal',
  onClick: (item, el) => {
    const e = !lockOn() && newest(item.config);
    openApp('journal', { from: el, params: e ? { id: e.id } : { section: lockOn() ? 'entries' : 'new' } });
  },
  // Widget settings: the newest entry of every journal, or of one journal
  async configure(config) {
    const list = journalChoices(['', 'journal.w.allJournals']);
    if (list.length < 3) return { ...config };
    const cur = list.some(([v]) => v === config.journal) ? config.journal : '';
    const v = await choose(t('journal.w.pickJournal'), list.map(([value, label]) => ({ value, label: t(label) })), cur);
    if (v == null) return null;
    const next = { ...config, journal: v };
    if (!v) delete next.journal;
    return next;
  },
  render(el, { size, config }) {
    el.classList.add('jrw', 'jrw-recent');
    let seq = 0;
    const draw = async () => {
      const my = ++seq;
      el.classList.remove('has-photo');
      el.style.removeProperty('--jrw-photo');
      // With Lock Journal on, the widget never shows an entry: anyone can see the Home screen.
      if (lockOn()) {
        return el.replaceChildren(h('div', { class: 'jrw-locked' }, h('span', { class: 'jrw-lock-ico', html: icon('lock', 26) }), h('b', null, t('journal.locked')), size === 'm' ? h('small', null, t('journal.lockedSub')) : null));
      }
      const e = newest(config);
      if (!e) {
        return el.replaceChildren(h('div', { class: 'jrw-empty' }, h('span', { class: 'jrw-book big', html: icon('jr-book', 26) }), h('b', null, t('journal.noEntries')), h('small', null, t('journal.startHint'))));
      }
      const mood = e.mood && M.moodOf(e.mood.level);
      const photo = (e.media || []).find((m) => m.k !== 'draw');
      const text = h('div', { class: 'jrw-entry' },
        h('div', { class: 'jrw-head' },
          mood ? h('span', { class: 'jrw-mood', style: { background: mood.color } }) : h('span', { class: 'jrw-book', html: icon('jr-book', 16) }),
          h('span', null, `${dayLabel(e.at)} · ${fmtTime(new Date(e.at))}`)),
        h('div', { class: 'jrw-title' }, e.title || firstLine(e.text) || t('journal.wRecent')),
        h('div', { class: 'jrw-text' }, e.title ? e.text : e.text.split('\n').slice(1).join('\n')));
      const thumb = size === 'm' && photo ? h('div', { class: 'jrw-thumb' }) : null;
      el.replaceChildren(...(thumb ? [h('div', { class: 'jrw-split' }, text, thumb)] : [text]));
      if (photo) {
        const u = await blobUrl(photo.id).catch(() => null);
        if (!u || my !== seq) return;
        if (thumb) thumb.style.backgroundImage = `url("${u}")`;
        else {
          el.classList.add('has-photo');
          el.style.setProperty('--jrw-photo', `url("${u}")`);
        }
      }
    };
    draw();
    const offs = [store.on(M.KEY, draw), store.on(M.LOCK_KEY, draw)];
    return () => offs.forEach((f) => f());
  },
});
