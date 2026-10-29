// Contacts: the pages behind the navigation drawer, each a One UI page with a large title — a group (members, Add
// members, Send message / email to all, Rename, Delete group), Manage contacts (Import, Export, Merge contacts, Delete
// contacts, Recycle bin), Merge contacts, the Recycle bin (kept 30 days: Restore, Delete permanently, Empty) and
// Contacts settings (Sort by, Name format, birthday notifications) — plus the group and contact pickers.
import { h, frag } from '../core/util.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { addStrings, t, lang, locale, fmtTime } from '../core/i18n.js';
import { toast, menu, dialog, confirm, prompt, choose, row, list, iconBtn } from '../core/ui.js';
import { delBlob } from '../core/blobs.js';
import * as M from './model.js';
import * as O from './organize.js';
import { data, mutate } from './data.js';
import { avatarHTML, avatarEl, hydrate, contactName, countText, telOf, handOff } from './format.js';
import { exportContacts } from './files.js';

const nameOf = (c) => contactName(c, data().prefs.order);
const sorted = (items) => O.sections(items, { sort: data().prefs.sort, lang: lang(), locale: locale() }).flatMap((s) => s.items);

// ---------------------------------------------------------------- pickers
/** A dialog with a checklist: resolves with the Set of picked values, or null when cancelled. */
export async function checklist(title, items, selected = [], { search = false, extra } = {}) {
  const set = new Set(selected);
  const box = h('div', { class: 'ct-chk scroll' });
  const draw = (q = '') => {
    const fq = M.fold(q);
    const shown = items.filter((it) => !fq || M.fold(it.label).includes(fq));
    box.replaceChildren(...shown.map((it) => {
      const cb = h('input', { type: 'checkbox', checked: set.has(it.value), onChange: () => (cb.checked ? set.add(it.value) : set.delete(it.value)) });
      return h('label', { class: 'ct-chk-row' }, cb, h('span', { class: 'ct-check' }), it.avatar ? frag(it.avatar) : null,
        h('span', { class: 'ct-chk-t' }, h('span', null, it.label), it.sub ? h('small', null, it.sub) : null));
    }), ...(shown.length ? [] : [h('div', { class: 'ct-chk-none' }, t('contacts.noResults'))]));
    hydrate(box);
  };
  const q = search ? h('input', { type: 'search', class: 'ct-chk-q', placeholder: t('common.search'), 'aria-label': t('common.search'), onInput: (e) => draw(e.target.value) }) : null;
  draw();
  const content = h('div', { class: 'ct-chk-wrap' }, q ? h('label', { class: 'ou-searchbox ct-chk-search' }, h('span', { html: icon('search', 18) }), q) : null, box, extra?.(set, (more) => {
    items.push(...more);
    draw(q?.value || '');
  }) || null);
  return dialog({ title, content, className: 'ct-dlg', actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => set, primary: true }] });
}

async function newGroupName() {
  const name = (await prompt(t('contacts.createGroup'), { placeholder: t('contacts.groupName'), okLabel: t('common.save') }))?.trim();
  if (!name) return null;
  const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  mutate((d) => {
    d.groups.push({ id, name, ids: [] });
  });
  return { id, name };
}

/** The groups checklist used by the editor (with Create group inside): resolves with group ids, or null. */
export function groupChecklist(selected) {
  const items = data().groups.map((g) => ({ value: g.id, label: g.name || t('contacts.untitledGroup') }));
  return checklist(t('contacts.groups'), items, selected, {
    extra: (set, add) => h('button', { class: 'ou-btn ct-chk-new', onClick: async () => {
      const g = await newGroupName();
      if (!g) return;
      set.add(g.id);
      add([{ value: g.id, label: g.name }]);
    } }, h('span', { html: icon('plus', 18) }), t('contacts.createGroup')),
  });
}

/** Groups for one contact (tick to add, untick to remove), or Add to group for several selected contacts. */
export async function pickGroups(app, ids, { add = false } = {}) {
  const d = data();
  const current = ids.length === 1 && !add ? d.groups.filter((g) => g.ids.includes(ids[0])).map((g) => g.id) : [];
  const res = await groupChecklist(current);
  if (!res) return;
  mutate((x) => {
    for (const g of x.groups) {
      if (res.has(g.id)) g.ids = [...new Set([...g.ids, ...ids])];
      else if (!add) g.ids = g.ids.filter((id) => !ids.includes(id));
    }
  });
  if (add) {
    toast(t('contacts.addedToGroup'));
    app.stopSelect?.();
  }
}

/** Contacts to add to a group: every contact not in it yet, with search. */
async function addMembers(gid) {
  const d = data(), g = d.groups.find((x) => x.id === gid);
  if (!g) return;
  const order = d.prefs.order;
  const items = sorted(d.items.filter((c) => !g.ids.includes(c.id))).map((c) => ({ value: c.id, label: contactName(c, order), sub: c.phones?.[0]?.v || c.emails?.[0]?.v || '', avatar: avatarHTML(c, { size: 36, order }) }));
  if (!items.length) return toast(t('contacts.allInGroup'));
  const res = await checklist(t('contacts.addMembers'), items, [], { search: items.length > 8 });
  if (!res?.size) return;
  mutate((x) => {
    const y = x.groups.find((z) => z.id === gid);
    if (y) y.ids = [...new Set([...y.ids, ...res])];
  });
}

// ---------------------------------------------------------------- a group
export async function createGroup(app) {
  const g = await newGroupName();
  if (!g) return;
  openGroup(app, g.id);
  setTimeout(() => addMembers(g.id), 380);
}

export function openGroup(app, gid) {
  const g0 = data().groups.find((x) => x.id === gid);
  if (!g0) return;
  const more = iconBtn('more', (e) => {
    const g = data().groups.find((x) => x.id === gid);
    if (!g) return;
    const members = g.ids.map((id) => M.byId(data(), id)).filter(Boolean);
    const nums = members.map((c) => c.phones?.[0]?.v).filter(Boolean).map(telOf);
    const mails = members.map((c) => c.emails?.[0]?.v).filter(Boolean);
    menu(e.currentTarget, [
      { label: t('common.rename'), icon: 'edit', onClick: async () => {
        const n = (await prompt(t('contacts.renameGroup'), { value: g.name, okLabel: t('common.save') }))?.trim();
        if (n) mutate((d) => { d.groups.find((x) => x.id === gid).name = n; });
      } },
      { label: t('contacts.sendMsg'), icon: 'ctMsg', disabled: !nums.length, onClick: () => handOff('sms:' + nums.join(',')) },
      { label: t('contacts.sendEmail'), icon: 'ctMail', disabled: !mails.length, onClick: () => handOff('mailto:' + mails.join(',')) },
      { label: t('contacts.exportGroup'), icon: 'ctExport', disabled: !members.length, onClick: () => exportContacts(members, g.name) },
      '-',
      { label: t('contacts.deleteGroup'), icon: 'trash', danger: true, onClick: async () => {
        if (!(await confirm(t('contacts.deleteGroupQ', { name: g.name }), t('contacts.deleteGroupMsg'), { okLabel: t('common.delete'), danger: true }))) return;
        app.ctx.pop();
        mutate((d) => { d.groups = d.groups.filter((x) => x.id !== gid); });
      } },
    ], { align: 'end' });
  }, t('common.more'));
  app.ctx.push({
    title: g0.name || t('contacts.untitledGroup'),
    className: 'ct-subpage',
    actions: [iconBtn('plus', () => addMembers(gid), t('contacts.addMembers')), more],
    render(body, page) {
      const draw = () => {
        const d = data(), g = d.groups.find((x) => x.id === gid);
        if (!g) return;
        page.setTitle(g.name || t('contacts.untitledGroup'));
        const members = sorted(g.ids.map((id) => M.byId(d, id)).filter(Boolean));
        page.setSubtitle(countText(members.length));
        if (!members.length) {
          body.replaceChildren(h('div', { class: 'ou-empty' }, h('span', { html: icon('ctGroup', 56) }), t('contacts.groupEmpty'), h('button', { class: 'ou-btn tonal', onClick: () => addMembers(gid) }, t('contacts.addMembers'))));
          return;
        }
        body.replaceChildren(h('div', { class: 'ct-card' }, members.map((c) => {
          const r = h('div', { class: 'ct-row', role: 'button', tabindex: 0, onClick: () => app.openContact(c.id) }, avatarEl(c, { size: 42, order: d.prefs.order }), h('span', { class: 'ct-row-t' }, h('span', { class: 'ct-row-name' }, nameOf(c))));
          r.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            menu(e, [{ label: t('contacts.removeFromGroup'), icon: 'minus', onClick: () => mutate((x) => { const y = x.groups.find((z) => z.id === gid); if (y) y.ids = y.ids.filter((id) => id !== c.id); }) }]);
          });
          r.addEventListener('keydown', (e) => e.key === 'Enter' && r.click());
          return r;
        })));
      };
      draw();
      return store.on(M.KEY, draw);
    },
  });
}

// ---------------------------------------------------------------- Manage contacts
export function openManage(app) {
  app.ctx.push({
    title: t('contacts.manage'),
    className: 'ct-subpage',
    render(body) {
      const draw = () => {
        const d = data();
        const dups = O.findDuplicates(d).length;
        const nContacts = d.items.length;
        body.replaceChildren(
          list(
            row({ icon: 'ctImport', title: t('contacts.import'), sub: t('contacts.importSub'), className: 'muted-sub', onClick: () => app.importFiles() }),
            row({ icon: 'ctExport', title: t('contacts.export'), sub: t('contacts.exportSub', { n: nContacts }), className: 'muted-sub', onClick: () => nContacts && exportContacts(sorted(d.items), t('app.contacts')) })),
          list(
            row({ icon: 'ctMerge', title: t('contacts.merge'), sub: dups === 1 ? t('contacts.dupsFound1') : dups ? t('contacts.dupsFound', { n: dups }) : t('contacts.noDups'), onClick: () => openMerge(app) }),
            row({ icon: 'trash', title: t('contacts.deleteContacts'), onClick: () => { app.ctx.pop(); app.startSelect(); } }),
            row({ icon: 'ctBin', title: t('contacts.bin'), sub: d.trash.length ? countText(d.trash.length) : null, className: 'muted-sub', onClick: () => openBin(app) })));
      };
      draw();
      return store.on(M.KEY, draw);
    },
  });
}

// ---------------------------------------------------------------- Merge contacts
export function openMerge(app) {
  app.ctx.push({
    title: t('contacts.merge'),
    className: 'ct-subpage',
    render(body) {
      const draw = () => {
        const d = data(), order = d.prefs.order;
        const groups = O.findDuplicates(d);
        if (!groups.length) {
          body.replaceChildren(h('div', { class: 'ou-empty' }, h('span', { html: icon('ctMerge', 56) }), t('contacts.noDups')));
          return;
        }
        body.replaceChildren(
          h('div', { class: 'ct-hint' }, t('contacts.mergeIntro')),
          ...groups.map((ids) => {
            const cs = ids.map((id) => M.byId(d, id)).filter(Boolean), m = O.mergeContacts(cs);
            const facts = [...(m.phones || []), ...(m.emails || [])].slice(0, 3).map((x) => x.v).join(', ');
            return h('div', { class: 'ct-card ct-merge' },
              h('div', { class: 'ct-row' }, avatarEl(m, { size: 46, order }), h('span', { class: 'ct-row-t' }, h('span', { class: 'ct-row-name' }, contactName(m, order)),
                h('span', { class: 'ct-row-sub' }, [countText(cs.length), facts].filter(Boolean).join(' · ')))),
              h('div', { class: 'ct-merge-btns' },
                h('button', { class: 'ou-btn tonal', onClick: () => mutate((x) => { for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) x.dupSkip.push([ids[i], ids[j]].sort().join('|')); }) }, t('contacts.keepSeparate')),
                h('button', { class: 'ou-btn primary', onClick: () => { mutate((x) => O.applyMerge(x, ids)); toast(t('contacts.merged')); } }, t('contacts.mergeBtn'))));
          }),
          h('button', { class: 'ou-btn primary ct-merge-all', onClick: () => {
            mutate((x) => { for (const ids of groups) O.applyMerge(x, ids); });
            toast(t('contacts.merged'));
          } }, t('contacts.mergeAll')));
        hydrate(body);
      };
      draw();
      return store.on(M.KEY, draw);
    },
  });
}

// ---------------------------------------------------------------- Recycle bin
export function openBin(app) {
  const purge = (entries) => entries.forEach((x) => x.c.photo && delBlob(x.c.photo).catch(() => {}));
  const more = iconBtn('more', (e) => {
    const trash = data().trash;
    menu(e.currentTarget, [
      { label: t('contacts.restoreAll'), icon: 'ctRestore', disabled: !trash.length, onClick: () => { mutate((d) => O.restoreContacts(d, d.trash.map((x) => x.c.id))); toast(t('contacts.restoredN', { n: trash.length })); } },
      { label: t('contacts.emptyBin'), icon: 'trash', danger: true, disabled: !trash.length, onClick: async () => {
        if (!(await confirm(t('contacts.emptyBinQ'), '', { okLabel: t('common.delete'), danger: true }))) return;
        purge(data().trash);
        mutate((d) => { d.trash = []; });
      } },
    ], { align: 'end' });
  }, t('common.more'));
  app.ctx.push({
    title: t('contacts.bin'),
    className: 'ct-subpage',
    actions: [more],
    render(body, page) {
      const draw = () => {
        const d = data(), order = d.prefs.order;
        page.setSubtitle(d.trash.length ? countText(d.trash.length) : '');
        const hint = h('div', { class: 'ct-hint' }, t('contacts.binHint'));
        if (!d.trash.length) {
          body.replaceChildren(hint, h('div', { class: 'ou-empty' }, h('span', { html: icon('ctBin', 56) }), t('contacts.binEmpty')));
          return;
        }
        body.replaceChildren(hint, h('div', { class: 'ct-card' }, d.trash.map((x) => {
          const left = O.daysLeft(x);
          const r = h('div', { class: 'ct-row', role: 'button', tabindex: 0 }, avatarEl(x.c, { size: 42, order }),
            h('span', { class: 'ct-row-t' }, h('span', { class: 'ct-row-name' }, contactName(x.c, order)), h('span', { class: 'ct-row-sub' }, left === 1 ? t('contacts.dayLeft') : t('contacts.daysLeft', { n: left }))));
          const act = (ev) => menu(ev.type === 'contextmenu' ? ev : r, [
            { label: t('contacts.restore'), icon: 'ctRestore', onClick: () => { mutate((dd) => O.restoreContacts(dd, [x.c.id])); toast(t('contacts.restored1')); } },
            { label: t('contacts.deleteForever'), icon: 'trash', danger: true, onClick: async () => {
              if (!(await confirm(t('contacts.deleteForeverQ'), '', { okLabel: t('common.delete'), danger: true }))) return;
              purge([x]);
              mutate((dd) => { dd.trash = dd.trash.filter((y) => y.c.id !== x.c.id); });
            } },
          ]);
          r.addEventListener('click', act);
          r.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            act(ev);
          });
          r.addEventListener('keydown', (ev) => ev.key === 'Enter' && act(ev));
          return r;
        })));
      };
      draw();
      return store.on(M.KEY, draw);
    },
  });
}

// ---------------------------------------------------------------- Contacts settings
const ALERTS = [[-1, 'contacts.bdayOff'], [0, 'contacts.bdayOnDay'], [1, 'contacts.bday1'], [2, 'contacts.bday2'], [7, 'contacts.bday7']];
export function openSettings(app) {
  const setPrefs = (patch) => mutate((d) => { d.prefs = { ...d.prefs, ...patch }; });
  app.ctx.push({
    title: t('contacts.settings'),
    className: 'ct-subpage',
    render(body) {
      const draw = () => {
        const p = data().prefs;
        const [hh, mm] = String(p.alertTime || '09:00').split(':').map(Number);
        const timeText = fmtTime(new Date(2000, 0, 1, hh || 0, mm || 0));
        body.replaceChildren(
          list(
            row({ icon: 'sort', title: t('contacts.sortBy'), sub: p.sort === 'last' ? t('contacts.byLast') : t('contacts.byFirst'), onClick: async () => {
              const v = await choose(t('contacts.sortBy'), [{ value: 'first', label: t('contacts.byFirst') }, { value: 'last', label: t('contacts.byLast') }], p.sort);
              if (v) setPrefs({ sort: v });
            } }),
            row({ icon: 'user', title: t('contacts.nameFormat'), sub: p.order === 'last' ? t('contacts.lastFirst') : t('contacts.firstFirst'), onClick: async () => {
              const v = await choose(t('contacts.nameFormat'), [{ value: 'first', label: t('contacts.firstFirst') }, { value: 'last', label: t('contacts.lastFirst') }], p.order);
              if (v) setPrefs({ order: v });
            } })),
          h('div', { class: 'ou-subheader' }, t('contacts.notifications')),
          list(
            row({ icon: 'ctCake', title: t('contacts.bdayNotif'), sub: t(ALERTS.find(([v]) => v === p.alert)?.[1] || 'contacts.bdayOnDay'), onClick: async () => {
              const v = await choose(t('contacts.bdayNotif'), ALERTS.map(([value, key]) => ({ value, label: t(key) })), p.alert);
              if (v != null) setPrefs({ alert: v });
            } }),
            row({ icon: 'clock', title: t('contacts.notifTime'), sub: timeText, className: p.alert < 0 ? 'ct-off' : '', onClick: async () => {
              if (p.alert < 0) return;
              const inp = h('input', { class: 'ou-input', type: 'time', value: p.alertTime || '09:00' });
              const v = await dialog({ title: t('contacts.notifTime'), content: h('div', { class: 'ou-dialog-body' }, inp), actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => inp.value, primary: true }] });
              if (v) setPrefs({ alertTime: v });
            } })),
          h('div', { class: 'ct-hint' }, t('contacts.notifHint')));
      };
      draw();
      return store.on(M.KEY, draw);
    },
  });
}

addStrings({
  en: {
    'contacts.groupName': 'Group name',
    'contacts.addedToGroup': 'Added to group',
    'contacts.allInGroup': 'Every contact is already in this group',
    'contacts.addMembers': 'Add members',
    'contacts.removeFromGroup': 'Remove from group',
    'contacts.renameGroup': 'Rename group',
    'contacts.sendMsg': 'Send message',
    'contacts.sendEmail': 'Send email',
    'contacts.exportGroup': 'Export group',
    'contacts.deleteGroup': 'Delete group',
    'contacts.deleteGroupQ': 'Delete “{name}”?',
    'contacts.deleteGroupMsg': 'The contacts in this group won’t be deleted.',
    'contacts.groupEmpty': 'No contacts in this group',
    'contacts.importSub': 'Add contacts from a vCard (.vcf) file',
    'contacts.exportSub': 'Save {n} contacts as a vCard (.vcf) file',
    'contacts.merge': 'Merge contacts',
    'contacts.dupsFound': '{n} sets of duplicates found',
    'contacts.dupsFound1': '1 set of duplicates found',
    'contacts.noDups': 'No duplicate contacts',
    'contacts.deleteContacts': 'Delete contacts',
    'contacts.mergeIntro': 'These contacts have the same name, phone number or email address. Merging combines their details into one contact.',
    'contacts.keepSeparate': 'Keep separate',
    'contacts.mergeBtn': 'Merge',
    'contacts.mergeAll': 'Merge all',
    'contacts.merged': 'Contacts merged',
    'contacts.binHint': 'Contacts you delete stay here for 30 days. After that, they’re deleted permanently.',
    'contacts.binEmpty': 'No contacts in the Recycle bin',
    'contacts.daysLeft': '{n} days left',
    'contacts.dayLeft': '1 day left',
    'contacts.restore': 'Restore',
    'contacts.restored1': 'Contact restored',
    'contacts.restoredN': '{n} contacts restored',
    'contacts.restoreAll': 'Restore all',
    'contacts.deleteForever': 'Delete permanently',
    'contacts.deleteForeverQ': 'Delete this contact permanently?',
    'contacts.emptyBin': 'Empty',
    'contacts.emptyBinQ': 'Delete all contacts in the Recycle bin permanently?',
    'contacts.sortBy': 'Sort by',
    'contacts.byFirst': 'First name',
    'contacts.byLast': 'Last name',
    'contacts.nameFormat': 'Name format',
    'contacts.firstFirst': 'First name first',
    'contacts.lastFirst': 'Last name first',
    'contacts.notifications': 'Notifications',
    'contacts.bdayNotif': 'Birthday notifications',
    'contacts.bdayOff': 'Off',
    'contacts.bdayOnDay': 'On the day',
    'contacts.bday1': '1 day before',
    'contacts.bday2': '2 days before',
    'contacts.bday7': '1 week before',
    'contacts.notifTime': 'Notification time',
    'contacts.notifHint': 'Birthday and Keep in touch notifications arrive even when no new tab is open.',
  },
  ar: {
    'contacts.groupName': 'اسم المجموعة',
    'contacts.addedToGroup': 'تمت الإضافة إلى المجموعة',
    'contacts.allInGroup': 'كل جهات الاتصال موجودة في هذه المجموعة بالفعل',
    'contacts.addMembers': 'إضافة أعضاء',
    'contacts.removeFromGroup': 'إزالة من المجموعة',
    'contacts.renameGroup': 'إعادة تسمية المجموعة',
    'contacts.sendMsg': 'إرسال رسالة',
    'contacts.sendEmail': 'إرسال بريد إلكتروني',
    'contacts.exportGroup': 'تصدير المجموعة',
    'contacts.deleteGroup': 'حذف المجموعة',
    'contacts.deleteGroupQ': 'هل تريد حذف «{name}»؟',
    'contacts.deleteGroupMsg': 'لن يتم حذف جهات الاتصال الموجودة في هذه المجموعة.',
    'contacts.groupEmpty': 'لا توجد جهات اتصال في هذه المجموعة',
    'contacts.importSub': 'إضافة جهات اتصال من ملف vCard ‏(.vcf)',
    'contacts.exportSub': 'حفظ {n} جهة اتصال كملف vCard ‏(.vcf)',
    'contacts.merge': 'دمج جهات الاتصال',
    'contacts.dupsFound': 'تم العثور على {n} مجموعات مكررة',
    'contacts.dupsFound1': 'تم العثور على مجموعة مكررة واحدة',
    'contacts.noDups': 'لا توجد جهات اتصال مكررة',
    'contacts.deleteContacts': 'حذف جهات الاتصال',
    'contacts.mergeIntro': 'جهات الاتصال هذه لها الاسم نفسه أو رقم الهاتف نفسه أو البريد الإلكتروني نفسه. يؤدي دمجها إلى جمع تفاصيلها في جهة اتصال واحدة.',
    'contacts.keepSeparate': 'إبقاؤها منفصلة',
    'contacts.mergeBtn': 'دمج',
    'contacts.mergeAll': 'دمج الكل',
    'contacts.merged': 'تم دمج جهات الاتصال',
    'contacts.binHint': 'تبقى جهات الاتصال التي تحذفها هنا لمدة 30 يومًا، ثم تُحذف نهائيًا.',
    'contacts.binEmpty': 'لا توجد جهات اتصال في سلة المحذوفات',
    'contacts.daysLeft': 'متبقٍ {n} أيام',
    'contacts.dayLeft': 'متبقٍ يوم واحد',
    'contacts.restore': 'استعادة',
    'contacts.restored1': 'تمت استعادة جهة الاتصال',
    'contacts.restoredN': 'تمت استعادة {n} جهة اتصال',
    'contacts.restoreAll': 'استعادة الكل',
    'contacts.deleteForever': 'حذف نهائي',
    'contacts.deleteForeverQ': 'هل تريد حذف جهة الاتصال هذه نهائيًا؟',
    'contacts.emptyBin': 'إفراغ',
    'contacts.emptyBinQ': 'هل تريد حذف كل جهات الاتصال في سلة المحذوفات نهائيًا؟',
    'contacts.sortBy': 'الفرز حسب',
    'contacts.byFirst': 'الاسم الأول',
    'contacts.byLast': 'اسم العائلة',
    'contacts.nameFormat': 'تنسيق الاسم',
    'contacts.firstFirst': 'الاسم الأول أولًا',
    'contacts.lastFirst': 'اسم العائلة أولًا',
    'contacts.notifications': 'الإشعارات',
    'contacts.bdayNotif': 'إشعارات أعياد الميلاد',
    'contacts.bdayOff': 'إيقاف',
    'contacts.bdayOnDay': 'في اليوم نفسه',
    'contacts.bday1': 'قبل يوم واحد',
    'contacts.bday2': 'قبل يومين',
    'contacts.bday7': 'قبل أسبوع',
    'contacts.notifTime': 'وقت الإشعار',
    'contacts.notifHint': 'تصل إشعارات أعياد الميلاد والبقاء على تواصل حتى عندما لا تكون هناك علامة تبويب جديدة مفتوحة.',
  },
});
