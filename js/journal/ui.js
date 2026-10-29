// The Journal app UI: Entries (journals as chips, suggestions from your day, entries as cards by month), Calendar
// (a month with your mood colours and photos, the entries of the chosen day) and Insights, as One UI bottom tabs;
// the editor, settings and Recycle bin are pages pushed over them. With Lock Journal on, a PIN screen comes first.
import './strings.js';
import { h, throttle } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtDate } from '../core/i18n.js';
import { store } from '../core/store.js';
import { toast, menu, confirm, subheader, seg } from '../core/ui.js';
import * as M from './model.js';
import { D, mut, pl, purgeOld } from './data.js';
import * as L from './lock.js';
import { pinView } from './keypad.js';
import { journalName, entryCard, hydrate, monthLabel, longDate } from './common.js';
import { openEditor } from './editor.js';
import { suggestionCards, promptCard, momentCard, journalDialog, exportEntries, editDate } from './sheets.js';
import { moments, recommended } from './suggestions.js';
import { renderInsights, firstDay } from './insights.js';
import { openSettings, editJournal, recycleBin, forgotPin } from './settings.js';

const TABS = [
  { id: 'entries', icon: 'jr-book', label: 'journal.tabEntries' },
  { id: 'calendar', icon: 'calendar', label: 'journal.tabCalendar' },
  { id: 'insights', icon: 'jr-chart', label: 'journal.tabInsights' },
];
const LS = 'jr.filter';
const lsGet = () => {
  try {
    return localStorage.getItem(LS) || 'all';
  } catch {
    return 'all';
  }
};
const lsSet = (v) => {
  try {
    localStorage.setItem(LS, v);
  } catch {}
};

export function render(ctx) {
  purgeOld();
  let tab = 'entries', filter = lsGet(), query = '', searchOpen = false, shown = 120;
  let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1), calDay = M.dayKey(Date.now()), insYear = new Date().getFullYear();
  let unlocked = false, pending = null, cur = null; // cur = { page, draw }
  let dirty = false;

  // ——— the search box lives outside the redrawn part, so typing never loses focus ———
  const searchInput = h('input', { type: 'search', placeholder: t('journal.searchPh'), 'aria-label': t('journal.searchPh'), dir: 'auto' });
  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    shown = 120;
    cur?.draw();
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (query || searchOpen)) {
      e.preventDefault();
      e.stopPropagation();
      closeSearch();
    }
  });
  const searchBox = h('label', { class: 'ou-searchbox jr-search' }, h('span', { html: icon('search', 20) }), searchInput);
  function closeSearch() {
    searchOpen = false;
    query = searchInput.value = '';
    if (tab === 'entries') showTab('entries');
  }

  function tabsBar() {
    return h('nav', { class: 'ou-tabs jr-tabs' }, TABS.map((x) => h('button', {
      class: ['ou-tab', x.id === tab && 'active'],
      dataset: { tab: x.id },
      'aria-current': x.id === tab ? 'page' : null,
      onClick: () => x.id !== tab && showTab(x.id),
    }, h('span', { html: icon(x.icon, 20) }), h('span', null, t(x.label)))));
  }
  const fab = (onClick) => h('button', { class: 'ou-fab jr-fab', title: t('journal.newEntry'), 'aria-label': t('journal.newEntry'), html: icon('edit', 24), onClick });

  function showTab(name) {
    tab = name;
    if (name === 'calendar') cur = calendarTab();
    else if (name === 'insights') cur = insightsTab();
    else cur = entriesTab();
    cur.page.el.append(tabsBar());
    cur.page.onReturn = () => {
      if (dirty) cur?.draw();
      dirty = false;
    };
    cur.draw();
  }
  const write = (draft = {}) => openEditor(ctx, { draft });

  // ——— Entries ———
  function entriesTab() {
    const searchBtn = h('button', { class: 'ou-icon-btn', title: t('common.search'), 'aria-label': t('common.search'), html: icon('search', 22), onClick: () => {
      searchOpen = !searchOpen;
      if (!searchOpen) return closeSearch();
      draw();
      page.scrollEl.scrollTop = 0;
      setTimeout(() => searchInput.focus(), 30);
    } });
    const moreBtn = h('button', { class: 'ou-icon-btn', title: t('common.more'), 'aria-label': t('common.more'), html: icon('more', 22), onClick: (e) => moreMenu(e.currentTarget) });
    const page = ctx.page({ title: t('app.journal'), actions: [searchBtn, moreBtn], className: 'jr-page jr-entries-page' });
    page.body.classList.add('jr-body');
    const content = h('div', { class: 'jr-content' });
    page.body.append(content);
    page.el.append(fab(() => {
      const j = filter.startsWith('j:') ? filter.slice(2) : undefined;
      write({ journal: j, bookmark: filter === 'bookmarked' || undefined });
    }));
    const draw = () => {
      const d = D();
      if (filter.startsWith('j:') && !M.journalById(d, filter.slice(2))) filter = 'all';
      const live = M.live(d), st = M.streak(d);
      page.setSubtitle([pl('journal.nEntries', live.length), st.current ? pl('journal.dayStreak', st.current) : ''].filter(Boolean).join(' · '));
      searchBtn.classList.toggle('active', searchOpen);
      // moving a focused input would blur it, so the box is only inserted once
      if (searchOpen && searchBox.parentNode !== page.body) page.body.prepend(searchBox);
      else if (!searchOpen) searchBox.remove();

      // journals as chips
      const chip = (id, label, extra = {}) => h('button', {
        class: ['ou-chip', 'jr-fchip', filter === id && 'active'],
        dataset: { filter: id },
        'aria-pressed': String(filter === id),
        onClick: () => {
          filter = id;
          lsSet(id);
          shown = 120;
          draw();
        },
        ...extra,
      }, ...(extra.children || [label]));
      const chips = h('div', { class: 'ou-chips jr-filters' },
        chip('all', t('journal.all')),
        chip('bookmarked', '', { children: [h('span', { html: icon('bookmark', 16) }), t('journal.bookmarked')] }),
        ...d.journals.map((j) => chip('j:' + j.id, '', {
          style: { '--jc': j.color },
          children: [h('i', { class: 'jr-jdot' }), journalName(j)],
          onContextmenu: (e) => {
            e.preventDefault();
            journalMenu(j.id, e);
          },
        })),
        h('button', { class: 'ou-chip jr-addchip', title: t('journal.newJournal'), 'aria-label': t('journal.newJournal'), html: icon('plus', 18), onClick: () => newJournal() }));

      let list = live.filter((e) => M.inView(d, e, filter) && M.matches(e, query));
      const parts = [chips];
      // suggestions from your day, on the main list only
      if (d.prefs.suggest && !query && filter === 'all') {
        const cards = suggestionCards((pick) => write(pick), { limit: 5 });
        if (cards.length) parts.push(h('section', { class: 'jr-sugg' },
          h('div', { class: 'jr-sugg-h' }, h('span', { class: 'jr-sugg-ico', html: icon('sparkle', 16) }), h('span', null, t('journal.suggestionsTitle')), h('button', { class: 'ou-btn jr-seeall', onClick: () => suggestionsPage() }, t('journal.seeAll'))),
          h('div', { class: 'jr-sugg-row' }, cards)));
      }
      if (query) parts.push(h('div', { class: 'jr-results' }, pl('journal.nResults', list.length)));
      if (!list.length) {
        parts.push(query
          ? h('div', { class: 'ou-empty' }, h('span', { html: icon('search', 56) }), t('journal.noResults'))
          : filter === 'bookmarked'
            ? h('div', { class: 'ou-empty' }, h('span', { html: icon('bookmark', 56) }), t('journal.noBookmarks'), h('small', null, t('journal.noBookmarksHint')))
            : h('div', { class: 'ou-empty jr-empty' }, h('span', { class: 'jr-empty-art', html: icon('jr-book', 56) }), h('b', null, t('journal.noEntries')), h('small', null, t('journal.emptyHint')),
              h('button', { class: 'ou-btn primary', onClick: () => write({ journal: filter.startsWith('j:') ? filter.slice(2) : undefined }) }, t('journal.write'))));
      } else {
        const more = list.length > shown;
        list = M.sorted(list).slice(0, shown);
        for (const g of M.byMonth(list)) {
          parts.push(h('section', { class: 'jr-month' }, subheader(monthLabel(g.at)), h('div', { class: 'jr-cards' }, g.entries.map((e) => entryCard(e, { d, onOpen: (x) => openEditor(ctx, { id: x.id }), onMenu: entryMenu, showJournal: !filter.startsWith('j:') })))));
        }
        if (more) parts.push(h('button', { class: 'ou-btn tonal jr-showmore', onClick: () => { shown += 120; draw(); } }, t('journal.showMore')));
      }
      content.replaceChildren(...parts);
      hydrate(content);
    };
    return { page, draw };
  }

  function moreMenu(anchor) {
    menu(anchor, [
      { label: t('journal.exportAll'), icon: 'download', onClick: () => exportEntries(M.live(D()), t('app.journal')) },
      { label: t('journal.recycleBin'), icon: 'trash', onClick: () => recycleBin(ctx) },
      L.lockOn() ? { label: t('journal.lockNow'), icon: 'lock', onClick: () => { L.forget(); relock(); } } : null,
      '-',
      { label: t('common.settings'), icon: 'settings', onClick: () => openSettings(ctx, { onLock: () => relock() }) },
    ], { align: 'end' });
  }

  async function entryMenu(e, at) {
    const d = D();
    const set = (patch) => mut((x) => { const y = M.byId(x, e.id); if (y) Object.assign(y, patch); });
    menu(at, [
      { label: e.bookmark ? t('journal.unbookmark') : t('journal.bookmark'), icon: 'bookmark', onClick: () => set({ bookmark: !e.bookmark || undefined }) },
      d.journals.length > 1 ? { label: t('journal.moveTo'), icon: 'folder', onClick: () => menu(at, d.journals.map((j) => ({ label: journalName(j), checked: M.journalOf(d, e) === j.id, onClick: () => set({ journal: j.id }) }))) } : null,
      { label: t('journal.editDate'), icon: 'calendar', onClick: async () => { const v = await editDate(e.at); if (v) set({ at: v }); } },
      { label: t('journal.export'), icon: 'download', onClick: () => exportEntries([e], e.title || longDate(e.at)) },
      '-',
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => removeEntry(e.id) },
    ]);
  }
  async function removeEntry(id) {
    if (!(await confirm(t('journal.deleteQ'), t('journal.deleteMsg'), { okLabel: t('common.delete'), danger: true }))) return;
    mut((d) => { const x = M.byId(d, id); if (x) x.deletedAt = Date.now(); });
    toast(t('journal.movedToBin'), { action: t('common.undo'), onAction: () => mut((d) => { const x = M.byId(d, id); if (x) delete x.deletedAt; }) });
  }
  async function newJournal() {
    const r = await journalDialog(null, { isNew: true });
    if (!r) return;
    const id = 'jn' + Date.now().toString(36);
    mut((d) => { d.journals.push({ id, name: r.name, color: r.color }); });
    filter = 'j:' + id;
    lsSet(filter);
    cur?.draw();
  }
  function journalMenu(id, at) {
    menu(at, [
      { label: t('journal.newEntry'), icon: 'edit', onClick: () => write({ journal: id }) },
      { label: t('journal.editJournal'), icon: 'edit', onClick: async () => { await editJournal(ctx, id); cur?.draw(); } },
    ]);
  }

  // ——— Journaling suggestions (See all) ———
  function suggestionsPage() {
    ctx.push({
      title: t('journal.suggestionsTitle'),
      render(body) {
        let mode = 'rec';
        const pick = (p) => {
          ctx.pop();
          setTimeout(() => write(p), 340);
        };
        const listEl = h('div', { class: 'jr-sgpage' });
        const draw = () => {
          const off = D().prefs.off, all = moments({ off });
          const parts = [];
          if (mode === 'rec') {
            if (!off.includes('prompts')) parts.push(promptCard(pick));
            const rec = recommended(all, 8);
            parts.push(...rec.map((m) => momentCard(m, pick)));
            if (!rec.length) parts.push(h('p', { class: 'jr-sg-none' }, t('journal.noMomentsHint')));
          } else {
            let last = '';
            for (const m of all) {
              const k = M.dayKey(m.at);
              if (k !== last) {
                parts.push(subheader(longDate(m.at)));
                last = k;
              }
              parts.push(momentCard(m, pick));
            }
            if (!all.length) parts.push(h('p', { class: 'jr-sg-none' }, t('journal.noMoments')));
          }
          listEl.replaceChildren(...parts);
        };
        body.append(seg([{ value: 'rec', label: t('journal.recommended') }, { value: 'recent', label: t('journal.recent') }], mode, (v) => { mode = v; draw(); }), listEl, h('p', { class: 'jr-set-note' }, t('journal.privacyNote')));
        draw();
      },
    });
  }

  // ——— Calendar ———
  function calendarTab() {
    const prev = h('button', { class: 'ou-icon-btn', title: t('journal.prevMonth'), 'aria-label': t('journal.prevMonth'), html: icon('back', 22), onClick: () => moveMonth(-1) });
    const next = h('button', { class: 'ou-icon-btn', title: t('journal.nextMonth'), 'aria-label': t('journal.nextMonth'), html: icon('forward', 22), onClick: () => moveMonth(1) });
    const todayBtn = h('button', { class: 'ou-btn jr-todaybtn', onClick: () => { calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); calDay = M.dayKey(Date.now()); draw(); } }, t('common.today'));
    const page = ctx.page({ title: monthLabel(+calMonth), hero: false, actions: [todayBtn, prev, next], className: 'jr-page jr-cal-page' });
    page.body.classList.add('jr-body');
    page.el.append(fab(() => {
      const now = new Date(), x = M.keyDate(calDay);
      x.setHours(now.getHours(), now.getMinutes());
      write({ at: Math.min(+x, Date.now()) });
    }));
    function moveMonth(n) {
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1);
      draw();
    }
    const draw = () => {
      const d = D(), live = M.live(d), today = M.dayKey(Date.now());
      page.setTitle(monthLabel(+calMonth));
      const byDay = new Map();
      for (const e of live) {
        const k = M.dayKey(e.at);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(e);
      }
      const fd = firstDay(), y = calMonth.getFullYear(), mo = calMonth.getMonth();
      const lead = (new Date(y, mo, 1).getDay() - fd + 7) % 7, n = new Date(y, mo + 1, 0).getDate();
      const dows = Array.from({ length: 7 }, (_, i) => h('span', { class: ['jr-cal-dow', (i + fd) % 7 === 0 && 'sun', (i + fd) % 7 === 6 && 'sat'] }, fmtDate(new Date(2024, 0, 7 + ((i + fd) % 7)), { weekday: 'narrow' })));
      const cells = [];
      for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'jr-cal-pad' }));
      for (let dd = 1; dd <= n; dd++) {
        const k = M.dayKey(+new Date(y, mo, dd)), list = byDay.get(k) || [];
        const mood = M.dayMood(list), photo = list.flatMap((e) => e.media || []).find((m) => m.k !== 'draw');
        const dow = new Date(y, mo, dd).getDay();
        cells.push(h('button', {
          class: ['jr-cal-d', list.length && 'has', mood && 'mood', photo && 'photo', k === today && 'today', k === calDay && 'sel', k > today && 'later', dow === 0 && 'sun', dow === 6 && 'sat'],
          style: { '--mc': mood ? M.moodOf(mood).color : 'var(--accent)' },
          dataset: { day: k },
          'aria-label': `${fmtDate(new Date(y, mo, dd), { weekday: 'long', month: 'long', day: 'numeric' })}${list.length ? ', ' + pl('journal.nEntries', list.length) : ''}`,
          'aria-pressed': String(k === calDay),
          onClick: () => { calDay = k; draw(); },
        },
          photo ? h('img', { class: 'jr-cal-img', dataset: { blob: photo.id }, alt: '' }) : null,
          h('span', { class: 'jr-cal-n' }, String(dd)),
          list.length > 1 ? h('i', { class: 'jr-cal-count' }, String(list.length)) : null));
      }
      const dayList = M.onDay(d, calDay);
      const monthCount = live.filter((e) => M.dayKey(e.at).startsWith(`${y}-${String(mo + 1).padStart(2, '0')}`)).length;
      page.body.replaceChildren(
        h('div', { class: 'ou-card jr-cal' }, h('div', { class: 'jr-cal-grid' }, dows, cells),
          h('div', { class: 'jr-cal-foot' }, pl('journal.nEntries', monthCount), h('span', { class: 'jr-grow' }), h('span', { class: 'jr-cal-legend' }, M.MOODS.map((m) => h('i', { title: '', style: { background: m.color } }))))),
        h('div', { class: 'jr-dayhead' }, h('b', null, longDate(+M.keyDate(calDay))), h('span', null, dayList.length ? pl('journal.nEntries', dayList.length) : '')),
        dayList.length
          ? h('div', { class: 'jr-cards' }, dayList.map((e) => entryCard(e, { d, onOpen: (x) => openEditor(ctx, { id: x.id }), onMenu: entryMenu })))
          : h('div', { class: 'jr-dayempty' }, h('span', null, calDay > today ? t('journal.futureDay') : t('journal.noEntriesDay')),
            calDay <= today ? h('button', { class: 'ou-btn tonal', onClick: () => page.el.querySelector('.jr-fab').click() }, h('span', { html: icon('edit', 18) }), t('journal.writeThisDay')) : null));
      hydrate(page.body);
    };
    return { page, draw };
  }

  // ——— Insights ———
  function insightsTab() {
    const page = ctx.page({ title: t('journal.tabInsights'), className: 'jr-page jr-ins-page' });
    page.body.classList.add('jr-body');
    const draw = () => {
      const d = D(), st = M.streak(d);
      page.setSubtitle(st.current ? pl('journal.dayStreak', st.current) : t('journal.insightsSub'));
      renderInsights(page.body, d, {
        year: insYear,
        onYear: (y) => { insYear = y; draw(); },
        onDay: (k) => { calDay = k; calMonth = new Date(M.keyDate(k).getFullYear(), M.keyDate(k).getMonth(), 1); showTab('calendar'); },
        onTag: (tg) => { searchOpen = true; query = searchInput.value = '#' + tg; filter = 'all'; showTab('entries'); },
      });
    };
    return { page, draw };
  }

  // ——— Lock Journal ———
  function showLock() {
    unlocked = false;
    cur = null;
    let v;
    ctx.page({
      title: '',
      hero: false,
      className: 'jr-lock-page',
      render(body) {
        v = pinView({
          title: t('journal.lockedTitle'),
          sub: t('journal.enterPin'),
          digits: L.rec().digits || 0,
          okLabel: t('common.ok'),
          onSubmit: async (pin) => {
            const r = await L.verify(pin);
            if (r.ok) {
              setTimeout(unlock, 120);
              return true;
            }
            return r.wait ? { wait: r.wait } : t('journal.pinWrong');
          },
          onForgot: async () => {
            if (await forgotPin()) unlock();
          },
        });
        body.append(v.el);
        if (L.waitLeft()) v.wait(L.waitLeft());
        return () => v.destroy();
      },
    });
  }
  function unlock() {
    unlocked = true;
    L.setOpen(true);
    L.markSeen();
    showTab(tab);
    const p = pending;
    pending = null;
    if (p) setTimeout(() => apply(p), 60);
  }
  function relock() {
    if (!L.lockOn()) return;
    L.setOpen(false);
    searchOpen = false;
    query = searchInput.value = '';
    // the entries leave the page (and an open editor saves and closes), so nothing is left to read behind the lock
    showLock();
  }

  // Locks again when the Journal is left: switching tabs or the Bloom lock screen count as leaving for "when Journal
  // closes"; a longer "Lock automatically" time counts from the last use.
  const away = () => {
    if (!unlocked || !L.lockOn()) return;
    if (!(L.rec().after > 0)) return relock();
    L.markSeen();
    L.setOpen(false);
  };
  const back = () => {
    if (!unlocked || !L.lockOn()) return;
    if (L.lockNeeded()) relock();
    else L.setOpen(true);
  };
  const onVis = () => (document.hidden ? away() : back());
  document.addEventListener('visibilitychange', onVis);
  const mo = new MutationObserver(() => (document.body.classList.contains('locked') ? away() : back()));
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const used = throttle(() => unlocked && L.lockOn() && L.markSeen(), 10e3);
  ctx.win.addEventListener('pointerdown', used, true);
  ctx.win.addEventListener('keydown', used, true);
  const onKey = (e) => {
    if (!unlocked || ctx.depth > 1 || tab !== 'entries' || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return;
    e.preventDefault();
    searchOpen = true;
    cur?.draw();
    searchInput.focus();
  };
  ctx.win.addEventListener('keydown', onKey);

  // ——— live updates ———
  const offs = [
    store.on(M.KEY, () => {
      if (!unlocked) return;
      if (ctx.depth > 1) dirty = true;
      else cur?.draw();
    }),
    // the lock turned off (here or in another tab) opens a locked journal; turning it on keeps this one open
    store.on(M.LOCK_KEY, () => {
      if (!unlocked && !L.lockOn()) unlock();
      else if (unlocked) L.setOpen(true);
    }),
  ];

  // ——— opening with params (widgets, notifications, Finder) ———
  function apply(p = {}) {
    if (!p || !Object.keys(p).length) return;
    if (!unlocked) {
      pending = p;
      return;
    }
    const s = /^remind/.test(p.section || '') ? 'new' : p.section;
    if (p.id) {
      if (ctx.depth > 1) showTab(tab);
      return openEditor(ctx, { id: p.id });
    }
    if (s === 'new' || p.prompt || p.moment) {
      if (ctx.depth > 1) showTab(tab);
      const draft = {};
      if (p.prompt && M.isPrompt(p.prompt)) draft.prompt = p.prompt;
      if (p.moment && typeof p.moment === 'object') draft.moment = p.moment;
      return write(draft);
    }
    if (s === 'entries' || s === 'calendar' || s === 'insights') return showTab(s);
    if (s === 'settings') {
      if (ctx.depth > 1) showTab(tab);
      return openSettings(ctx, { onLock: () => relock() });
    }
    if (s === 'search') {
      searchOpen = true;
      showTab('entries');
      setTimeout(() => searchInput.focus(), 60);
    }
  }
  ctx.setParams = (p) => apply(p);

  if (L.lockNeeded()) {
    pending = ctx.params;
    showLock();
  } else {
    unlocked = true;
    L.setOpen(true);
    L.markSeen();
    const s = ctx.params?.section;
    showTab(s === 'calendar' || s === 'insights' ? s : 'entries');
    apply(ctx.params);
  }

  return () => {
    if (unlocked) L.markSeen();
    L.setOpen(false);
    offs.forEach((f) => f());
    document.removeEventListener('visibilitychange', onVis);
    mo.disconnect();
    ctx.win.removeEventListener('pointerdown', used, true);
    ctx.win.removeEventListener('keydown', used, true);
    ctx.win.removeEventListener('keydown', onKey);
  };
}
