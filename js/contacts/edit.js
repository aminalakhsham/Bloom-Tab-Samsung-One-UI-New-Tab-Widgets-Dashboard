// Contacts: the Create / Edit contact form, laid out like Samsung's: the round picture with a camera badge (Gallery,
// Stickers, Background colour), the name (⌄ shows prefix, middle name, suffix and phonetic names), phone numbers and
// email addresses with label chips (Mobile ▾, Home ▾, Custom…), Groups, then "View more" for nickname, organisation,
// addresses, events (birthday and other dates, with or without a year), websites, relationships and notes. Cancel and
// Save sit in One UI's bottom bar. It edits a draft; onSave(contact, groupIds) gets the result.
import { h, uid, pickFile } from '../core/util.js';
import { icon } from '../core/icons.js';
import { putBlob, delBlob } from '../core/blobs.js';
import { addStrings, t, fmtDate } from '../core/i18n.js';
import { toast, menu, dialog, prompt, swatches } from '../core/ui.js';
import * as M from './model.js';
import { data } from './data.js';
import { avatarEl, labelText, fieldName, addrPart, contactName, AV_COLORS } from './format.js';
import { groupChecklist } from './pages.js';
import { shrinkImage } from './files.js';

const STICKERS = ['😀', '😎', '🥳', '😍', '🤓', '😇', '🤠', '🧐', '👩', '👨', '👧', '👦', '👵', '👴', '👩‍💻', '👨‍🍳', '🧑‍🎨', '🦸', '🐶', '🐱', '🦊', '🐼', '🦁', '🐸', '🌸', '🌻', '⚽', '🎸', '✈️', '❤️', '⭐', '🍀'];
const EXTRA_NAMES = ['prefix', 'first', 'middle', 'last', 'suffix', 'pfirst', 'pmiddle', 'plast'];
const KINDS = {
  phones: { ic: 'ctPhone', add: 'contacts.addPhone', ph: 'contacts.phonePh', type: 'tel', ltr: true },
  emails: { ic: 'ctMail', add: 'contacts.addEmail', ph: 'contacts.emailPh', type: 'email', ltr: true },
  addrs: { ic: 'location', add: 'contacts.addAddress' },
  events: { ic: 'calendar', add: 'contacts.addEvent' },
  urls: { ic: 'globe', add: 'contacts.addUrl', ph: 'contacts.urlPh', type: 'url', ltr: true },
  related: { ic: 'user', add: 'contacts.addRelation', ph: 'contacts.relationPh' },
};
const EVENT_LABELS = ['birthday', 'anniversary', 'other'];
const today = () => {
  const n = new Date();
  return M.dayKey({ y: null, m: n.getMonth() + 1, d: n.getDate() });
};

/** The editor for contact `c` (null for Create contact). Returns { el, focus(), cancel(), leave(), dispose() }. */
export function makeEditor(c, { group, onSave, onCancel } = {}) {
  const orig = c ? structuredClone(c) : {};
  const st = structuredClone(orig);
  st.events = [...(st.bday ? [{ l: 'birthday', v: st.bday }] : []), ...(st.dates || [])];
  delete st.bday;
  delete st.dates;
  const d0 = data();
  const groups = new Set(c ? d0.groups.filter((g) => g.ids.includes(c.id)).map((g) => g.id) : group ? [group] : []);
  const groupSig = () => [...groups].sort().join('|');
  const origGroups = groupSig();
  let showNames = EXTRA_NAMES.some((k) => k !== 'first' && k !== 'last' && st[k]);
  let showMore = !!(st.nick || st.maiden || st.company || st.job || st.dept || st.addrs?.length || st.events.length || st.urls?.length || st.related?.length || st.social?.length || st.note);
  const made = new Set(); // photos added while editing (deleted again unless saved)
  let saved = false, asking = false;

  const scroll = h('div', { class: 'ct-escroll scroll' });
  const saveBtn = h('button', { class: 'ct-ebtn primary', onClick: () => save() }, t('common.save'));
  const el = h('div', { class: 'ct-edit' }, scroll, h('div', { class: 'ct-ebar' }, h('button', { class: 'ct-ebtn', onClick: () => cancel() }, t('common.cancel')), saveBtn));
  const names = d0.items.filter((x) => x.id !== c?.id).map((x) => contactName(x, d0.prefs.order));
  const listId = 'ct-dl-' + uid();

  // ---------------------------------------------------------------- building blocks
  const changed = () => (saveBtn.disabled = !canSave());
  const input = (get, set, ph, { type = 'text', ltr = false, list } = {}) => {
    const i = h('input', { class: 'ct-in', type, value: get() || '', placeholder: ph, 'aria-label': ph, dir: ltr ? 'ltr' : 'auto', spellcheck: 'false', autocomplete: 'off', list });
    i.addEventListener('input', () => {
      set(i.value);
      changed();
    });
    return i;
  };
  const nameInput = (k) => input(() => st[k], (v) => (st[k] = v), fieldName(k));
  const ico = (name) => h('span', { class: 'ct-eico', html: name ? icon(name, 22) : '' });
  const minus = (onClick) => h('button', { class: 'ct-eminus', title: t('common.remove'), 'aria-label': t('common.remove'), onClick, html: icon('minus', 16) });
  function chip(kind, e) {
    const labels = kind === 'events' ? EVENT_LABELS : M.LABELS[kind] || [];
    const b = h('button', { class: 'ct-chip', 'aria-haspopup': 'menu' }, h('span', null, labelText(e.l)), h('span', { html: icon('down', 14) }));
    b.addEventListener('click', () => menu(b, [
      ...labels.map((l) => ({ label: labelText(l), checked: e.l === l, disabled: kind === 'events' && l === 'birthday' && e.l !== 'birthday' && st.events.some((x) => x.l === 'birthday'), onClick: () => setLabel(l) })),
      ...(!labels.includes(e.l) ? [{ label: labelText(e.l), checked: true, onClick: () => {} }] : []),
      '-',
      { label: t('contacts.custom'), icon: 'edit', onClick: async () => {
        const v = (await prompt(t('contacts.customLabel'), { value: labels.includes(e.l) ? '' : e.l, okLabel: t('common.ok') }))?.trim();
        if (v) setLabel(v);
      } },
    ]));
    function setLabel(l) {
      e.l = l;
      b.firstChild.textContent = labelText(l);
      changed();
    }
    return b;
  }
  function dateSelects(e) {
    const p = M.parseDay(e.v) || M.parseDay(today());
    const set = () => {
      const y = ys.value ? +ys.value : null, m = +ms.value;
      const max = new Date(y || 2000, m, 0).getDate(); // February has 29 days when there's no year
      if (+ds.value > max) ds.value = String(max);
      e.v = M.dayKey({ y, m, d: +ds.value });
      changed();
    };
    const sel = (cls, label, opts, val) => {
      const s = h('select', { class: ['ct-sel', cls], 'aria-label': label, onChange: set }, opts.map(([v, txt]) => h('option', { value: String(v), selected: String(v) === String(val) }, txt)));
      return s;
    };
    const year = new Date().getFullYear();
    const ds = sel('d', t('contacts.day'), Array.from({ length: 31 }, (_, i) => [i + 1, fmtDate(new Date(2000, 0, i + 1), { day: 'numeric' })]), p.d);
    const ms = sel('m', t('contacts.month'), Array.from({ length: 12 }, (_, i) => [i + 1, fmtDate(new Date(2000, i, 1), { month: 'long' })]), p.m);
    const ys = sel('y', t('contacts.year'), [['', t('contacts.noYear')], ...Array.from({ length: year - 1899 + 1 }, (_, i) => [year + 1 - i, String(year + 1 - i)])], p.y || '');
    return h('div', { class: 'ct-date' }, ds, ms, ys);
  }
  /** One card of repeatable rows (phones, emails, addresses, events, websites, relationships) with its Add button. */
  function multiCard(kind) {
    const k = KINDS[kind];
    const list = kind === 'events' ? st.events : (st[kind] ||= []);
    const rows = list.map((e, i) => {
      let field;
      if (kind === 'addrs') {
        field = h('div', { class: 'ct-addr' }, ...M.ADDR_PARTS.map((p) => input(() => e[p], (v) => (e[p] = v), addrPart(p))));
      } else if (kind === 'events') field = dateSelects(e);
      else field = input(() => e.v, (v) => (e.v = v), t(k.ph), { type: k.type, ltr: k.ltr, list: kind === 'related' ? listId : null });
      return h('div', { class: ['ct-erow', 'kind-' + kind], dataset: { kind, i: String(i) } }, ico(i ? '' : k.ic), h('div', { class: 'ct-efield' }, chip(kind, e), field), minus(() => {
        list.splice(i, 1);
        redraw();
      }));
    });
    const add = h('button', { class: 'ct-eadd', onClick: () => addRow(kind) }, ico(rows.length ? '' : k.ic), h('span', { html: icon('plus', 18) }), h('span', null, t(k.add)));
    return h('div', { class: 'ct-ecard' }, ...rows, add);
  }
  function addRow(kind) {
    if (kind === 'events') {
      const l = st.events.some((x) => x.l === 'birthday') ? (st.events.some((x) => x.l === 'anniversary') ? 'other' : 'anniversary') : 'birthday';
      st.events.push({ l, v: today() });
    } else {
      const list = (st[kind] ||= []);
      list.push(kind === 'addrs' ? { l: M.nextLabel(kind, list) } : { l: M.nextLabel(kind, list), v: '' });
    }
    redraw();
    const last = [...scroll.querySelectorAll(`.ct-erow.kind-${kind}`)].pop();
    last?.querySelector('input, select')?.focus();
    changed();
  }

  // ---------------------------------------------------------------- the form
  function draw() {
    const photoBtn = h('button', { class: 'ct-ephoto', title: t('contacts.picture'), 'aria-label': t('contacts.picture'), onClick: (e) => photoMenu(e.currentTarget) },
      avatarEl({ ...st, id: st.id || 'new', first: st.first, last: st.last }, { size: 104, order: d0.prefs.order }), h('span', { class: 'ct-ecam', html: icon('ctCamera', 18) }));
    const expand = h('button', { class: ['ct-eexpand', showNames && 'open'], title: t('contacts.moreNames'), 'aria-label': t('contacts.moreNames'), 'aria-expanded': String(showNames), html: icon('down', 20), onClick: () => {
      showNames = !showNames;
      redraw();
    } });
    const nameKeys = showNames ? EXTRA_NAMES : ['first', 'last'];
    const nameRows = nameKeys.map((k, i) => h('div', { class: 'ct-erow' }, ico(i ? '' : 'ctPerson'), h('div', { class: 'ct-efield' }, nameInput(k)), i ? h('span', { class: 'ct-espace' }) : expand));
    const groupNames = data().groups.filter((g) => groups.has(g.id)).map((g) => g.name || t('contacts.untitledGroup'));
    const groupRow = h('button', { class: 'ct-erow ct-egroups', onClick: async () => {
      const res = await groupChecklist(groups);
      if (!res) return;
      groups.clear();
      res.forEach((id) => groups.add(id));
      redraw();
      changed();
    } }, ico('ctGroup'), h('div', { class: 'ct-efield' }, h('span', { class: ['ct-evalue', !groupNames.length && 'ph'] }, groupNames.join(', ') || t('contacts.groups'))), h('span', { class: 'ct-espace', html: icon('forward', 18) }));

    const parts = [
      h('div', { class: 'ct-ephotowrap' }, photoBtn),
      h('div', { class: 'ct-ecard' }, ...nameRows),
      multiCard('phones'),
      multiCard('emails'),
      h('div', { class: 'ct-ecard' }, groupRow),
    ];
    if (!showMore) parts.push(h('button', { class: 'ou-btn ct-viewmore', onClick: () => {
      showMore = true;
      redraw();
    } }, t('contacts.viewMore')));
    else {
      const rowsOf = (keys, ic) => keys.map((k, i) => h('div', { class: 'ct-erow' }, ico(i ? '' : ic), h('div', { class: 'ct-efield' }, nameInput(k))));
      const note = h('textarea', { class: 'ct-in ct-note', rows: 3, placeholder: t('contacts.notes'), 'aria-label': t('contacts.notes'), dir: 'auto' });
      note.value = st.note || '';
      const fit = () => {
        note.style.height = 'auto';
        note.style.height = note.scrollHeight + 'px';
      };
      note.addEventListener('input', () => {
        st.note = note.value;
        fit();
        changed();
      });
      requestAnimationFrame(fit);
      parts.push(
        h('div', { class: 'ct-ecard' }, ...rowsOf(['nick', 'maiden'], 'user')),
        h('div', { class: 'ct-ecard' }, ...rowsOf(['company', 'dept', 'job', 'pcompany'], 'ctCard')),
        multiCard('addrs'),
        multiCard('events'),
        multiCard('urls'),
        multiCard('related'),
        h('div', { class: 'ct-ecard' }, h('div', { class: 'ct-erow' }, ico('note'), h('div', { class: 'ct-efield' }, note))),
      );
    }
    parts.push(h('datalist', { id: listId }, names.map((n) => h('option', { value: n }))));
    scroll.replaceChildren(...parts);
    changed();
  }
  function redraw() {
    const top = scroll.scrollTop;
    draw();
    scroll.scrollTop = top;
  }

  // ---------------------------------------------------------------- picture
  function photoMenu(anchor) {
    const has = st.photo || st.av?.e || st.av?.c;
    menu(anchor, [
      { label: t('contacts.gallery'), icon: 'image', onClick: choosePhoto },
      { label: t('contacts.stickers'), icon: 'sparkle', onClick: stickers },
      { label: t('contacts.bgColour'), icon: 'palette', onClick: colours },
      has ? '-' : null,
      has ? { label: t('contacts.removePicture'), icon: 'trash', danger: true, onClick: () => {
        delete st.photo;
        delete st.av;
        redraw();
        changed();
      } } : null,
    ]);
  }
  async function choosePhoto() {
    const f = await pickFile('image/*');
    if (!f) return;
    try {
      const blob = await shrinkImage(f, 640);
      const key = 'contacts:' + uid();
      await putBlob(key, blob);
      made.add(key);
      st.photo = key;
      if (st.av?.e) delete st.av.e;
      redraw();
      changed();
    } catch (e) {
      console.warn('contact photo', e);
      toast(t('contacts.badImage'));
    }
  }
  async function stickers() {
    let pickedE = st.av?.e || STICKERS[0];
    const grid = h('div', { class: 'ct-stickers' }, STICKERS.map((e) => h('button', { class: ['ct-sticker', e === pickedE && 'on'], onClick: (ev) => {
      pickedE = e;
      grid.querySelectorAll('.ct-sticker').forEach((b) => b.classList.toggle('on', b === ev.currentTarget));
    } }, e)));
    const v = await dialog({ title: t('contacts.stickers'), content: grid, className: 'ct-dlg', actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => pickedE, primary: true }] });
    if (!v) return;
    delete st.photo;
    st.av = { ...(st.av || {}), e: v };
    redraw();
    changed();
  }
  async function colours() {
    let col = st.av?.c || null;
    const sw = swatches(AV_COLORS, col, (c2) => (col = c2));
    const v = await dialog({ title: t('contacts.bgColour'), content: h('div', { class: 'ct-swatches' }, sw), className: 'ct-dlg', actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => col || '', primary: true }] });
    if (v == null) return;
    delete st.photo;
    const av = { ...(st.av || {}) };
    if (v) av.c = v;
    else delete av.c;
    if (Object.keys(av).length) st.av = av;
    else delete st.av;
    redraw();
    changed();
  }

  // ---------------------------------------------------------------- results
  function build() {
    const now = Date.now();
    const evs = st.events.filter((e) => M.parseDay(e.v));
    const b = evs.find((e) => e.l === 'birthday');
    const draft = { ...st, bday: b?.v || null, dates: evs.filter((e) => e !== b).map((e) => ({ l: e.l === 'birthday' ? 'other' : e.l, v: e.v })) };
    delete draft.events;
    return M.normContact({ ...draft, id: st.id || 'c' + uid(), created: st.created || now, updated: now });
  }
  const canSave = () => !M.isEmpty(build());
  const sig = (x) => JSON.stringify(M.normContact({ ...x, id: 'x', created: 0, updated: 0 }));
  const dirty = () => sig(build()) !== sig(orig) || groupSig() !== origGroups;
  function dropMade(keep) {
    for (const k of made) if (k !== keep) delBlob(k).catch(() => {});
    made.clear();
  }
  function save() {
    const out = build();
    if (M.isEmpty(out)) return;
    saved = true;
    dropMade(out.photo);
    if (orig.photo && orig.photo !== out.photo) delBlob(orig.photo).catch(() => {});
    onSave?.(out, new Set(groups));
  }
  async function cancel() {
    if (asking) return;
    if (dirty()) {
      asking = true;
      const ok = await dialog({ message: t('contacts.discardQ'), actions: [{ label: t('common.cancel'), value: false }, { label: t('contacts.discard'), value: true, danger: true }] });
      asking = false;
      if (!ok) return;
    }
    dropMade();
    onCancel?.();
  }
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.code === 'KeyS')) {
      e.preventDefault();
      save();
    }
  });

  draw();
  return {
    el,
    focus: () => setTimeout(() => scroll.querySelector('input')?.focus({ preventScroll: true }), 80),
    cancel,
    /** Leaving for another contact: fine when nothing changed, otherwise ask first (and stay). */
    leave() {
      if (!dirty()) {
        dropMade();
        return true;
      }
      cancel();
      return false;
    },
    dispose() {
      if (!saved) dropMade();
    },
  };
}

addStrings({
  en: {
    'contacts.editTitle': 'Edit contact',
    'contacts.picture': 'Contact picture',
    'contacts.gallery': 'Gallery',
    'contacts.stickers': 'Stickers',
    'contacts.bgColour': 'Background colour',
    'contacts.removePicture': 'Remove picture',
    'contacts.badImage': 'This picture can’t be used',
    'contacts.moreNames': 'More name fields',
    'contacts.addPhone': 'Add phone number',
    'contacts.addEmail': 'Add email',
    'contacts.addAddress': 'Add address',
    'contacts.addEvent': 'Add event',
    'contacts.addUrl': 'Add website',
    'contacts.addRelation': 'Add relationship',
    'contacts.phonePh': 'Phone number',
    'contacts.emailPh': 'Email',
    'contacts.urlPh': 'Website',
    'contacts.relationPh': 'Name',
    'contacts.viewMore': 'View more',
    'contacts.custom': 'Custom',
    'contacts.customLabel': 'Custom label',
    'contacts.day': 'Day',
    'contacts.month': 'Month',
    'contacts.year': 'Year',
    'contacts.noYear': 'No year',
    'contacts.discardQ': 'Discard your changes?',
    'contacts.discard': 'Discard',
  },
  ar: {
    'contacts.editTitle': 'تعديل جهة الاتصال',
    'contacts.picture': 'صورة جهة الاتصال',
    'contacts.gallery': 'الاستوديو',
    'contacts.stickers': 'الملصقات',
    'contacts.bgColour': 'لون الخلفية',
    'contacts.removePicture': 'إزالة الصورة',
    'contacts.badImage': 'لا يمكن استخدام هذه الصورة',
    'contacts.moreNames': 'حقول اسم إضافية',
    'contacts.addPhone': 'إضافة رقم هاتف',
    'contacts.addEmail': 'إضافة بريد إلكتروني',
    'contacts.addAddress': 'إضافة عنوان',
    'contacts.addEvent': 'إضافة مناسبة',
    'contacts.addUrl': 'إضافة موقع ويب',
    'contacts.addRelation': 'إضافة صلة قرابة',
    'contacts.phonePh': 'رقم الهاتف',
    'contacts.emailPh': 'البريد الإلكتروني',
    'contacts.urlPh': 'موقع الويب',
    'contacts.relationPh': 'الاسم',
    'contacts.viewMore': 'عرض المزيد',
    'contacts.custom': 'مخصص',
    'contacts.customLabel': 'تسمية مخصصة',
    'contacts.day': 'اليوم',
    'contacts.month': 'الشهر',
    'contacts.year': 'السنة',
    'contacts.noYear': 'بدون سنة',
    'contacts.discardQ': 'هل تريد تجاهل التغييرات؟',
    'contacts.discard': 'تجاهل',
  },
});
