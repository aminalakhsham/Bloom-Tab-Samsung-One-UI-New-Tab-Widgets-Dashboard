// Contacts — Samsung Contacts (One UI) style. This file only registers the app and what lives outside its window:
// the Favourite contacts and Upcoming birthdays widgets, Finder results (any field) and commands ("call Sara",
// "email Omar", "message …", "birthdays"), and the Lock screen's next-birthday chip. The app itself (list, detail,
// editor, groups, Manage contacts, Recycle bin, settings) loads from js/contacts/ui.js when it opens; birthday and
// Keep in touch notifications come from the service worker (js/bg/contacts.js).
import { h, escapeHtml } from '../core/util.js';
import { icon } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerCommand, registerLockWidget } from '../core/hooks.js';
import { store } from '../core/store.js';
import { addStrings, t } from '../core/i18n.js';
import { registerAction, RunError, toText } from '../routines/actions.js';
import * as M from '../contacts/model.js';
import { data, upcomingBirthdays, searchContacts } from '../contacts/data.js';
import { avatarHTML, hydrate, contactName, labelText, birthdaySub, whenText, handOff, telOf } from '../contacts/format.js';

// Other surfaces (Calendar's birthdays, a morning brief…) import these from here or from js/contacts/data.js.
export { upcomingBirthdays, searchContacts, findContact } from '../contacts/data.js';

const open = (id, from) => openApp('contacts', { from, params: id ? { id } : {} });

registerApp({
  id: 'contacts',
  name: 'app.contacts',
  icon: {
    bg: 'linear-gradient(145deg, #ff9757 0%, #f4572f 100%)',
    glyph: '<circle cx="12" cy="8.4" r="3.7"/><path d="M4.8 19.6c.9-3.7 3.7-5.8 7.2-5.8s6.3 2.1 7.2 5.8"/>',
  },
  keywords: ['contacts', 'people', 'phone book', 'address book', 'vcard', 'vcf', 'birthday', 'جهات الاتصال', 'الأسماء', 'دفتر العناوين', 'أعياد الميلاد'],
  size: 'wide',
  render: (ctx) => import('../contacts/ui.js').then((m) => m.render(ctx)),
  search(q) {
    if (q.trim().length < 2) return [];
    return searchContacts(q, 4).map((x) => {
      const c = x.contact;
      const sub = x.field ? (x.field === 'note' ? x.value.split('\n')[0] : x.value) : c.phones?.[0]?.v || c.emails?.[0]?.v || c.company || t('app.contacts');
      return { title: contactName(c, data().prefs.order), sub, onOpen: () => open(c.id) };
    });
  },
});

// ——— Finder commands ———
const CALL = [/^(?:call|phone|dial|ring)\s+(.+)$/i, /^(?:اتصل|اتصال|كلم|كلّم)\s+(.+)$/];
const MAIL = [/^(?:email|e-mail|mail)\s+(.+)$/i, /^(?:راسل|ايميل|إيميل|بريد)\s+(?:إلى\s+|الى\s+|ل)?(.+)$/];
const MSG = [/^(?:message|text|sms|msg)\s+(.+)$/i, /^(?:رسالة|رساله|أرسل رسالة|ارسل رسالة)\s+(?:إلى\s+|الى\s+|ل)?(.+)$/];
const BDAYS = /^(?:birthdays?|upcoming birthdays|bdays?|أعياد الميلاد|اعياد الميلاد|أعياد ميلاد|عيد الميلاد|عيد ميلاد)$/i;

/** Contacts that have a `kind` field and match a name typed after a command word; an Arabic "ب" glued to the name
 *  ("اتصل بسارة") is tried without it when the whole word finds nobody. */
function people(rest, kind) {
  const tries = [rest.trim()];
  if (/^بـ?\S/.test(tries[0])) tries.push(tries[0].replace(/^بـ?/, ''));
  for (const q of tries) {
    const found = searchContacts(q, 6).filter((x) => x.score >= 70 && x.contact[kind]?.length).slice(0, 3);
    if (found.length) return found.map((x) => x.contact);
  }
  return [];
}

registerCommand('contacts', (q, lower, done) => {
  const out = [];
  const order = () => data().prefs.order;
  const verbs = [[CALL, 'phones', 'ctPhone', 'contacts.cmdCall', (v) => 'tel:' + telOf(v)], [MSG, 'phones', 'ctMsg', 'contacts.cmdMsg', (v) => 'sms:' + telOf(v)], [MAIL, 'emails', 'ctMail', 'contacts.cmdMail', (v) => 'mailto:' + v]];
  for (const [res, kind, ic, key, url] of verbs) {
    const m = res.map((re) => re.exec(q)).find(Boolean);
    if (!m) continue;
    for (const c of people(m[1], kind)) {
      const e = c[kind][0];
      out.push({ icon: ic, title: t(key, { name: contactName(c, order()) }), sub: `${labelText(e.l)} · ${e.v}`, run: () => { done?.(); handOff(url(e.v)); } });
    }
  }
  if (BDAYS.test(q.trim())) {
    const list = upcomingBirthdays(365).slice(0, 3);
    if (!list.length) out.push({ icon: 'ctCake', title: t('contacts.noBdays'), sub: t('app.contacts'), run: () => { done?.(); open(); } });
    for (const b of list) out.push({ icon: 'ctCake', title: t('contacts.bdayOf', { name: b.name || t('contacts.noName') }), sub: birthdaySub(b), run: () => { done?.(); open(b.id); } });
  }
  return out;
});

// ——— Routines: Call / Send message to a contact (handed to the system's phone or messages app, like the detail page) ———
/** The best contact with a phone number for a name typed in the routine. */
function reach(name) {
  const q = toText(name ?? '').trim();
  if (!q) throw new RunError('contacts.ra.noName');
  const found = searchContacts(q, 8).filter((x) => x.score >= 70);
  if (!found.length) throw new RunError('contacts.ra.noMatch', { name: q });
  const c = found.find((x) => x.contact.phones?.length)?.contact;
  if (!c) throw new RunError('contacts.ra.noPhone', { name: contactName(found[0].contact, data().prefs.order) });
  return c;
}
const who = { key: 'name', type: 'text', label: 'contacts.ra.who', ph: 'contacts.ra.whoPh' };
registerAction({
  id: 'contacts.call', name: 'contacts.ra.call', icon: 'ctPhone', color: '#22a356', cat: 'apps', out: 'contacts.ra.out',
  params: [who], sub: (p, F) => F.text(p.name),
  run(ctx, p) {
    if (!ctx.page) throw new RunError('routines.err.page');
    const c = reach(p.name);
    handOff('tel:' + telOf(c.phones[0].v));
    return contactName(c, data().prefs.order);
  },
});
registerAction({
  id: 'contacts.message', name: 'contacts.ra.message', icon: 'ctMsg', color: '#3e7bff', cat: 'apps', out: 'contacts.ra.out',
  params: [who, { key: 'text', type: 'text', label: 'contacts.ra.text', ph: 'contacts.ra.textPh', input: true }],
  sub: (p, F) => F.text(p.name) + (F.text(p.text) ? ' · ' + F.text(p.text) : ''),
  run(ctx, p) {
    if (!ctx.page) throw new RunError('routines.err.page');
    const c = reach(p.name), body = toText(p.text ?? '').trim();
    handOff('sms:' + telOf(c.phones[0].v) + (body ? '?body=' + encodeURIComponent(body) : ''));
    return contactName(c, data().prefs.order);
  },
});

// ——— Lock screen: the next birthday (no name while locked) ———
registerLockWidget('contacts-birthday', {
  name: 'contacts.lockName',
  render: async ({ locked } = {}) => {
    const b = upcomingBirthdays(30)[0];
    if (!b) return null;
    const when = whenText(b.date);
    return h('span', { class: 'lk-w lk-w-ct' }, h('span', { html: icon('ctCake', 18) }), locked ? t('contacts.lockBday', { when }) : `${b.name || t('contacts.noName')} · ${when}`);
  },
});

// ——— widgets ———
const firstName = (c) => c.nick || c.first || contactName(c, data().prefs.order);

// Widget settings pick up to four people (config.people); with none picked (or all of them deleted) it shows the
// favourites, as before.
async function pickPeople(config) {
  const d = data();
  if (!d.items.length) return { ...config, people: [] };
  const { checklist } = await import('../contacts/pages.js');
  const favs = new Set(d.favs), order = d.prefs.order;
  const items = d.items.map((c) => ({ value: c.id, label: contactName(c, order), avatar: avatarHTML(c, { size: 36, order }), fav: favs.has(c.id) }))
    .sort((a, b) => b.fav - a.fav || a.label.localeCompare(b.label));
  const cur = (config.people || []).filter((id) => M.byId(d, id));
  const set = await checklist(t('contacts.wPick'), items, cur, { search: d.items.length > 8, extra: () => h('p', { class: 'ct-wpick-hint' }, t('contacts.wPickHint')) });
  return set ? { ...config, people: [...set].slice(0, 4) } : null;
}

registerWidget({
  id: 'contacts-favorites',
  name: 'contacts.wFav',
  sizes: ['s', 'm'],
  defaultSize: 'm',
  app: 'contacts',
  configure: (config) => pickPeople(config),
  render(el, { size, config = {} }) {
    el.classList.add('wg-ct', 'wg-ct-fav');
    const draw = () => {
      const d = data(), of = (ids) => (ids || []).map((id) => M.byId(d, id)).filter(Boolean).slice(0, 4);
      let people = of(config.people);
      if (!people.length) people = of(d.favs);
      if (!people.length) {
        el.innerHTML = `<div class="wg-ct-empty">${icon('starFill', 28)}<span></span></div>`;
        el.querySelector('span').textContent = t('contacts.favEmpty');
        return;
      }
      el.innerHTML = `<div class="wg-ct-grid n${people.length}">${people.map((c) => `<div class="wg-ct-p">
        <button class="wg-ct-open" data-id="${escapeHtml(c.id)}">${avatarHTML(c, { size: size === 's' ? 52 : 56, order: d.prefs.order })}<b></b></button>
        ${size === 'm' && c.phones?.length ? `<button class="wg-ct-call" data-call="${escapeHtml(c.id)}">${icon('ctPhone', 15)}</button>` : ''}</div>`).join('')}</div>`;
      el.querySelectorAll('.wg-ct-open b').forEach((b, i) => (b.textContent = firstName(people[i])));
      el.querySelectorAll('.wg-ct-open').forEach((b, i) => b.setAttribute('aria-label', contactName(people[i], d.prefs.order)));
      el.querySelectorAll('.wg-ct-call').forEach((b) => b.setAttribute('aria-label', t('contacts.call')));
      hydrate(el);
    };
    el.addEventListener('click', (e) => {
      const call = e.target.closest('[data-call]');
      if (call) {
        const c = M.byId(data(), call.dataset.call);
        if (c?.phones?.length) handOff('tel:' + telOf(c.phones[0].v));
        return;
      }
      const b = e.target.closest('[data-id]');
      if (b) open(b.dataset.id, el);
    });
    draw();
    return store.on(M.KEY, draw);
  },
});

registerWidget({
  id: 'contacts-birthdays',
  name: 'contacts.wBday',
  sizes: ['s', 'm'],
  defaultSize: 's',
  app: 'contacts',
  onClick(item, el) {
    const b = upcomingBirthdays(365)[0];
    open(b?.id, el);
  },
  render(el, { size }) {
    el.classList.add('wg-ct', 'wg-ct-bday');
    const draw = () => {
      const d = data(), now = new Date();
      const list = upcomingBirthdays(365, now);
      const head = `<div class="wg-head wg-ct-head">${icon('ctCake', 16)}<span></span></div>`;
      if (!list.length) {
        el.innerHTML = `${head}<div class="wg-ct-empty">${icon('ctCake', 30)}<span class="wg-ct-msg"></span></div>`;
        el.querySelector('.wg-ct-msg').textContent = t('contacts.noBdays');
      } else if (size === 's') {
        const b = list[0], c = M.byId(d, b.id);
        el.innerHTML = `${head}<div class="wg-ct-one ${b.date.toDateString() === now.toDateString() ? 'today' : ''}">${avatarHTML(c, { size: 48, order: d.prefs.order })}<b class="wg-ct-name"></b><span class="wg-ct-when"></span>${list.length > 1 ? '<span class="wg-ct-more"></span>' : ''}</div>`;
        el.querySelector('.wg-ct-name').textContent = b.name || t('contacts.noName');
        el.querySelector('.wg-ct-when').textContent = birthdaySub(b, now);
        if (list.length > 1) el.querySelector('.wg-ct-more').textContent = t('contacts.more', { n: list.length - 1 });
      } else {
        el.innerHTML = `${head}<div class="wg-ct-rows">${list.slice(0, 3).map((b) => `<button class="wg-ct-row ${b.date.toDateString() === now.toDateString() ? 'today' : ''}" data-id="${escapeHtml(b.id)}">${avatarHTML(M.byId(d, b.id), { size: 34, order: d.prefs.order })}<span class="wg-ct-txt"><b></b><small></small></span></button>`).join('')}</div>`;
        el.querySelectorAll('.wg-ct-row').forEach((row, i) => {
          row.querySelector('b').textContent = list[i].name || t('contacts.noName');
          row.querySelector('small').textContent = birthdaySub(list[i], now);
        });
      }
      el.querySelector('.wg-ct-head span').textContent = t('contacts.birthdays');
      hydrate(el);
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (b) open(b.dataset.id, el);
    });
    draw();
    const off = store.on(M.KEY, draw);
    const tick = setInterval(draw, 10 * 60e3); // "Tomorrow" becomes "Today" after midnight
    return () => {
      off();
      clearInterval(tick);
    };
  },
});

addStrings({
  en: {
    'app.contacts': 'Contacts',
    'contacts.wFav': 'Favourite contacts',
    'contacts.wBday': 'Upcoming birthdays',
    'contacts.birthdays': 'Birthdays',
    'contacts.noBdays': 'No upcoming birthdays',
    'contacts.favEmpty': 'Add favourites in Contacts to see them here',
    'contacts.more': '+{n} more',
    'contacts.lockName': 'Next birthday',
    'contacts.lockBday': 'Birthday · {when}',
    'contacts.cmdCall': 'Call {name}',
    'contacts.cmdMsg': 'Message {name}',
    'contacts.cmdMail': 'Email {name}',
    'contacts.bdayOf': '{name}’s birthday',
    'contacts.call': 'Call',
    'contacts.wPick': 'Contacts to show',
    'contacts.wPickHint': 'Pick up to 4. With none picked, the widget shows your favourites.',
    'contacts.ra.call': 'Call contact',
    'contacts.ra.message': 'Send message',
    'contacts.ra.who': 'Contact',
    'contacts.ra.whoPh': 'Name',
    'contacts.ra.text': 'Message',
    'contacts.ra.textPh': 'Message (optional)',
    'contacts.ra.out': 'Contact',
    'contacts.ra.noName': 'Enter a contact’s name.',
    'contacts.ra.noMatch': 'There’s no contact called “{name}”.',
    'contacts.ra.noPhone': '{name} has no phone number.',
  },
  ar: {
    'app.contacts': 'جهات الاتصال',
    'contacts.wFav': 'جهات الاتصال المفضلة',
    'contacts.wBday': 'أعياد الميلاد القادمة',
    'contacts.birthdays': 'أعياد الميلاد',
    'contacts.noBdays': 'لا توجد أعياد ميلاد قادمة',
    'contacts.favEmpty': 'أضف جهات اتصال إلى المفضلة لتظهر هنا',
    'contacts.more': '+{n} أخرى',
    'contacts.lockName': 'عيد الميلاد التالي',
    'contacts.lockBday': 'عيد ميلاد · {when}',
    'contacts.cmdCall': 'الاتصال بـ{name}',
    'contacts.cmdMsg': 'مراسلة {name}',
    'contacts.cmdMail': 'إرسال بريد إلى {name}',
    'contacts.bdayOf': 'عيد ميلاد {name}',
    'contacts.call': 'اتصال',
    'contacts.wPick': 'جهات الاتصال المعروضة',
    'contacts.wPickHint': 'اختر حتى 4. إذا لم تختر أحدًا، تعرض الأداة جهات الاتصال المفضلة.',
    'contacts.ra.call': 'الاتصال بجهة اتصال',
    'contacts.ra.message': 'إرسال رسالة',
    'contacts.ra.who': 'جهة الاتصال',
    'contacts.ra.whoPh': 'الاسم',
    'contacts.ra.text': 'الرسالة',
    'contacts.ra.textPh': 'الرسالة (اختياري)',
    'contacts.ra.out': 'جهة الاتصال',
    'contacts.ra.noName': 'أدخل اسم جهة الاتصال.',
    'contacts.ra.noMatch': 'لا توجد جهة اتصال باسم ”{name}“.',
    'contacts.ra.noPhone': 'لا يوجد رقم هاتف لـ{name}.',
  },
});
