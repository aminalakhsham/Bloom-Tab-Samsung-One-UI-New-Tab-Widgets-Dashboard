// Journal settings (⋮ › Settings, like every One UI app): suggestions and their sources, the journaling schedule,
// Lock Journal, journals and the default one, export; plus the Journals and Recycle bin pages.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtTime, weekdayNames } from '../core/i18n.js';
import { row, switchRow, list, subheader, choose, confirm, toast, menu, iconBtn } from '../core/ui.js';
import { store } from '../core/store.js';
import * as M from './model.js';
import { D, mut, pl, syncSchedule, dropBlobs } from './data.js';
import * as L from './lock.js';
import { setPinFlow, verifyFlow } from './keypad.js';
import { journalName, entryCard, hydrate } from './common.js';
import { journalDialog, exportEntries } from './sheets.js';
import { KINDS } from './suggestions.js';
import { firstDay } from './insights.js';

const setPrefs = (patch) => mut((d) => { Object.assign(d.prefs, patch); });

export function schedText(sc) {
  if (!sc.on || !sc.days.length) return t('common.off');
  const days = [...sc.days].sort();
  const [hh, mm] = sc.time.split(':').map(Number);
  const when = fmtTime(new Date(2024, 0, 1, hh, mm));
  const names = weekdayNames('short');
  const which = days.length === 7 ? t('journal.everyDay') : days.join() === '1,2,3,4,5' ? t('journal.weekdays') : days.join() === '0,6' ? t('journal.weekends') : days.map((x) => names[x]).join(t('journal.comma'));
  return `${which} · ${when}`;
}
const afterText = (m) => (!m ? t('journal.afterClose') : m === 60 ? t('journal.after1h') : pl('journal.afterMin', m));

/** ⋮ › Settings. hooks: { onLock() } is called when the journal should lock now. */
export function openSettings(ctx, hooks = {}) {
  ctx.push({
    title: t('journal.settings'),
    render(body) {
      const draw = () => {
        const d = D(), p = d.prefs, lk = L.rec(), on = L.lockOn();
        body.replaceChildren(
          subheader(t('journal.suggestions')),
          list(
            switchRow({ icon: 'sparkle', iconBg: M.ACCENT, title: t('journal.showSuggestions'), sub: t('journal.showSuggestionsSub'), checked: p.suggest, onChange: (v) => setPrefs({ suggest: v }) }),
            row({ icon: 'list', iconBg: '#ff8a3d', title: t('journal.sources'), sub: pl('journal.nSourcesOn', M.SOURCES.length - p.off.filter((x) => M.SOURCES.includes(x)).length), chevron: true, className: 'muted-sub', onClick: () => sourcesPage(ctx) })),
          h('p', { class: 'jr-set-note' }, t('journal.privacyNote')),
          subheader(t('journal.reminders')),
          list(row({ icon: 'bell', iconBg: '#e5484d', title: t('journal.schedule'), sub: schedText(p.schedule), chevron: true, onClick: () => schedulePage(ctx) })),
          subheader(t('journal.privacy')),
          list(
            switchRow({ icon: 'lock', iconBg: '#5d5e66', title: t('journal.lockJournal'), sub: t('journal.lockSub'), checked: on, onChange: (v) => toggleLock(v) }),
            // One UI apps can follow the screen lock instead of keeping a PIN of their own (Settings › Lock screen)
            L.screenPinAvailable() ? switchRow({ icon: 'fingerprint', iconBg: '#3e7bff', title: t('journal.useScreenPin'), sub: t('journal.useScreenPinSub'), checked: on && lk.kind === 'screen', onChange: (v) => toggleScreenPin(v) }) : null,
            on && lk.kind !== 'screen' ? row({ icon: 'keyboard', iconBg: '#3e7bff', title: t('journal.changePin'), chevron: true, onClick: () => changePin() }) : null,
            on ? row({ icon: 'clock', iconBg: '#14b8a6', title: t('journal.lockAfter'), sub: afterText(lk.after || 0), onClick: () => pickAfter() }) : null,
            on ? row({ icon: 'lock', iconBg: '#7b61ff', title: t('journal.lockNow'), onClick: () => { L.forget(); hooks.onLock?.(); } }) : null),
          subheader(t('journal.journals')),
          list(
            row({ icon: 'jr-book', iconBg: M.ACCENT, title: t('journal.manageJournals'), sub: pl('journal.nJournals', d.journals.length), chevron: true, className: 'muted-sub', onClick: () => journalsPage(ctx) }),
            row({ icon: 'folder', iconBg: '#f5a524', title: t('journal.defaultJournal'), sub: journalName(M.journalById(d, M.defJournal(d))), onClick: () => pickDefault() })),
          list(
            row({ icon: 'download', iconBg: '#22a356', title: t('journal.exportAll'), sub: t('journal.exportSub'), className: 'muted-sub', onClick: () => exportEntries(M.live(D()), t('app.journal')) }),
            row({ icon: 'trash', iconBg: '#8a8d96', title: t('journal.recycleBin'), sub: pl('journal.nEntries', M.deleted(d).length), chevron: true, className: 'muted-sub', onClick: () => recycleBin(ctx) })));
      };
      async function toggleLock(v) {
        if (v) {
          const pin = await setPinFlow(ctx);
          if (pin) {
            await L.setPin(pin);
            toast(t('journal.lockOnToast'));
          }
        } else if (await verifyFlow(ctx, { title: t('journal.lockJournal'), verify: L.verify, digits: L.rec().digits })) {
          L.turnOff();
          toast(t('journal.lockOffToast'));
        }
        draw();
      }
      // On: the screen lock PIN opens the Journal (its own PIN, if any, is asked first and then forgotten). Off: back to a
      // PIN of the Journal's own, after the screen PIN; cancelling the new PIN keeps the screen PIN.
      async function toggleScreenPin(v) {
        const r = L.rec();
        if (v) {
          if (L.lockOn() && r.kind !== 'screen' && !(await verifyFlow(ctx, { title: t('journal.useScreenPin'), verify: L.verify, digits: r.digits }))) return draw();
          if (L.useScreenPin()) toast(t('journal.screenPinOnToast'));
        } else if (await verifyFlow(ctx, { title: t('journal.useScreenPin'), verify: L.verify, digits: r.digits })) {
          const pin = await setPinFlow(ctx);
          if (pin) {
            await L.setPin(pin);
            toast(t('journal.lockOnToast'));
          }
        }
        draw();
      }
      async function changePin() {
        if (!(await verifyFlow(ctx, { title: t('journal.changePin'), verify: L.verify, digits: L.rec().digits }))) return;
        const pin = await setPinFlow(ctx, { title: t('journal.changePin') });
        if (pin) {
          await L.setPin(pin);
          toast(t('journal.pinChanged'));
        }
        draw();
      }
      async function pickAfter() {
        const v = await choose(t('journal.lockAfter'), L.AFTER.map((m) => ({ value: m, label: afterText(m) })), L.rec().after || 0);
        if (v != null) L.setAfter(v);
        draw();
      }
      async function pickDefault() {
        const d = D();
        const v = await choose(t('journal.defaultJournal'), d.journals.map((j) => ({ value: j.id, label: journalName(j) })), M.defJournal(d));
        if (v) setPrefs({ def: v });
        draw();
      }
      draw();
      // the screen lock PIN set or removed in Settings › Lock screen shows or hides "Use screen lock PIN"
      const offs = [store.on(M.KEY, draw), store.on(M.LOCK_KEY, draw), store.on('pin', draw)];
      return () => offs.forEach((f) => f());
    },
  });
}

function sourcesPage(ctx) {
  ctx.push({
    title: t('journal.sources'),
    render(body) {
      const p = D().prefs;
      const src = (id, ic, color) => switchRow({ icon: ic, iconBg: color, title: t('journal.src.' + id), checked: !p.off.includes(id), onChange: (v) => {
        mut((d) => {
          const off = new Set(d.prefs.off);
          v ? off.delete(id) : off.add(id);
          d.prefs.off = [...off];
        });
      } });
      body.append(
        list(...Object.values(KINDS).map((k) => src(k.src, k.icon, k.color)), src('prompts', 'sparkle', M.ACCENT)),
        h('p', { class: 'jr-set-note' }, t('journal.sourcesNote')));
    },
  });
}

function schedulePage(ctx) {
  ctx.push({
    title: t('journal.schedule'),
    render(body) {
      const draw = () => {
        const sc = D().prefs.schedule;
        const set = (patch) => {
          let p;
          mut((d) => {
            d.prefs.schedule = { ...d.prefs.schedule, ...patch };
            p = d.prefs;
          });
          syncSchedule(p);
          draw();
        };
        const names = weekdayNames('narrow'), long = weekdayNames('long'), fd = firstDay();
        const order = Array.from({ length: 7 }, (_, i) => (i + fd) % 7);
        const time = h('input', { class: 'ou-input jr-time', type: 'time', value: sc.time, 'aria-label': t('journal.time'), onChange: (e) => e.target.value && set({ time: e.target.value }) });
        body.replaceChildren(
          h('div', { class: 'ou-card ou-list jr-sched-master' }, switchRow({ title: sc.on ? t('common.on') : t('common.off'), checked: sc.on, onChange: (v) => set({ on: v, days: sc.days.length ? sc.days : [0, 1, 2, 3, 4, 5, 6] }) })),
          h('p', { class: 'jr-set-note' }, t('journal.scheduleNote')),
          sc.on ? h('div', { class: 'ou-card jr-sched' },
            h('div', { class: 'jr-sched-label' }, t('journal.days')),
            h('div', { class: 'jr-days' }, order.map((i) => h('button', { class: ['jr-day', sc.days.includes(i) && 'on'], title: long[i], 'aria-label': long[i], 'aria-pressed': String(sc.days.includes(i)), onClick: () => {
              const days = sc.days.includes(i) ? sc.days.filter((x) => x !== i) : [...sc.days, i].sort();
              set({ days, on: days.length > 0 });
            } }, names[i]))),
            h('div', { class: 'jr-sched-label' }, t('journal.time')), time,
            h('p', { class: 'jr-sched-next' }, schedText(sc))) : null);
      };
      draw();
    },
  });
}

/** Journals: rename, recolour, delete, add. */
export function journalsPage(ctx) {
  ctx.push({
    title: t('journal.journals'),
    render(body, page) {
      const add = async () => {
        const r = await journalDialog(null, { isNew: true });
        if (!r) return;
        mut((d) => { d.journals.push({ id: 'jn' + Date.now().toString(36), name: r.name, color: r.color }); });
        draw();
      };
      page.setActions([iconBtn('plus', add, t('journal.newJournal'))]);
      const draw = () => {
        const d = D(), live = M.live(d);
        body.replaceChildren(list(...d.journals.map((j) => {
          const n = live.filter((e) => M.journalOf(d, e) === j.id).length;
          return row({
            icon: 'jr-book', iconBg: j.color, title: journalName(j), sub: pl('journal.nEntries', n), className: 'muted-sub',
            right: M.defJournal(d) === j.id ? h('span', { class: 'jr-def' }, t('journal.default')) : null,
            onClick: () => editJournal(ctx, j.id).then(draw),
          });
        })), h('button', { class: 'ou-btn jr-add-journal', onClick: add }, h('span', { html: icon('plus', 18) }), t('journal.newJournal')));
      };
      draw();
    },
  });
}

/** Edit or delete one journal (its entries go to the Recycle bin). Resolves when done. */
export async function editJournal(ctx, id) {
  const d = D(), j = M.journalById(d, id);
  if (!j) return;
  const r = await journalDialog(j, { canDelete: d.journals.length > 1 });
  if (!r) return;
  if (r === 'delete') {
    const n = M.live(d).filter((e) => M.journalOf(d, e) === id).length;
    if (!(await confirm(t('journal.deleteJournalQ', { name: journalName(j) }), n ? t('journal.deleteJournalMsg') : '', { okLabel: t('common.delete'), danger: true }))) return;
    const now = Date.now();
    mut((x) => {
      for (const e of x.entries) if (!e.deletedAt && M.journalOf(x, e) === id) e.deletedAt = now;
      x.journals = x.journals.filter((y) => y.id !== id);
      if (x.prefs.def === id) x.prefs.def = '';
    });
    return 'deleted';
  }
  mut((x) => {
    const y = M.journalById(x, id);
    if (y) Object.assign(y, r);
  });
}

/** Recycle bin: entries deleted in the last 30 days; restore or delete them for good. */
export function recycleBin(ctx) {
  ctx.push({
    title: t('journal.recycleBin'),
    render(body, page) {
      const restore = (ids) => mut((d) => { for (const e of d.entries) if (ids.includes(e.id)) delete e.deletedAt; });
      const erase = async (ids) => {
        if (!ids.length) return;
        if (!(await confirm(ids.length === 1 ? t('journal.eraseQ1') : t('journal.eraseQ', { n: ids.length }), t('journal.eraseMsg'), { okLabel: t('common.delete'), danger: true }))) return;
        const gone = M.blobIds({ entries: D().entries.filter((e) => ids.includes(e.id)) });
        mut((d) => { d.entries = d.entries.filter((e) => !ids.includes(e.id)); });
        dropBlobs(gone);
      };
      page.setActions([iconBtn('more', (e) => menu(e.currentTarget, [
        { label: t('journal.restoreAll'), icon: 'history', disabled: !M.deleted(D()).length, onClick: () => restore(M.deleted(D()).map((x) => x.id)) },
        { label: t('journal.emptyBin'), icon: 'trash', danger: true, disabled: !M.deleted(D()).length, onClick: () => erase(M.deleted(D()).map((x) => x.id)) },
      ], { align: 'end' }), t('common.more'))]);
      const draw = () => {
        const d = D(), del = M.deleted(d);
        const onMenu = (e, at) => menu(at, [
          { label: t('journal.restore'), icon: 'history', onClick: () => restore([e.id]) },
          { label: t('journal.deleteForever'), icon: 'trash', danger: true, onClick: () => erase([e.id]) },
        ]);
        body.replaceChildren(
          h('p', { class: 'jr-set-note jr-bin-note' }, t('journal.binNote')),
          del.length
            ? h('div', { class: 'jr-cards' }, del.map((e) => entryCard(e, { d, deleted: true, onOpen: (x, ev) => onMenu(x, ev), onMenu })))
            : h('div', { class: 'ou-empty' }, h('span', { html: icon('trash', 56) }), t('journal.binEmpty')));
        hydrate(body);
      };
      draw();
      return store.on(M.KEY, draw);
    },
  });
}

/** Forgot PIN: the only way back in is to erase the journal (entries, pictures and the lock). */
export async function forgotPin() {
  if (!(await confirm(t('journal.forgotQ'), t('journal.forgotMsg'), { okLabel: t('journal.erase'), danger: true }))) return false;
  const ids = M.blobIds(D());
  store.set(M.KEY, { ...M.norm(null), prefs: D().prefs, journals: D().journals });
  L.turnOff();
  dropBlobs(ids);
  toast(t('journal.erased'));
  return true;
}
