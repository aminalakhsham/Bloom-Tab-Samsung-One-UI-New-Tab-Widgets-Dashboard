// Contacts: the contact detail page, laid out like Samsung's: the big round picture and name, round Call / Message /
// Video call / Email buttons (hand-off links; video opens Google Meet, as One UI's dialer does), cards with the phone
// numbers, email addresses and the rest of the details (click to call, write or open; right-click to copy), groups,
// Keep in touch, and One UI's bottom bar: Favourite, Edit, Share, More. Drawn into the wide window's detail pane or a
// pushed page.
import { h, escapeHtml } from '../core/util.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { addStrings, t, fmtRelative } from '../core/i18n.js';
import { toast, menu, choose } from '../core/ui.js';
import * as M from './model.js';
import { data, mutate } from './data.js';
import { avatarEl, contactName, labelText, fieldName, dayText, whenText, ageText, handOff, telOf } from './format.js';
import { pickGroups } from './pages.js';
import { shareContacts, contactText } from './files.js';

const KEEP = [[1, 'w'], [2, 'w'], [1, 'm'], [3, 'm'], [6, 'm'], [12, 'm']];
export const keepText = (k) => (!k ? t('common.off') : k.u === 'w' ? (k.n === 1 ? t('contacts.keepW1') : t('contacts.keepWn', { n: k.n }))
  : k.n === 12 ? t('contacts.keepY') : k.n === 1 ? t('contacts.keepM1') : t('contacts.keepMn', { n: k.n }));
const webUrl = (v) => (/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v);
const SOCIAL_URL = { Twitter: 'https://x.com/', Facebook: 'https://facebook.com/', LinkedIn: 'https://www.linkedin.com/in/', Flickr: 'https://www.flickr.com/people/', Myspace: 'https://myspace.com/', 'Sina Weibo': 'https://weibo.com/' };

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('contacts.copied'));
  } catch {
    toast(t('contacts.copyFail'));
  }
}

/** Marks that you were in touch (a call, message or email from the card), so Keep in touch starts counting again. */
function touched(c) {
  if (c?.keep) mutate((d) => {
    const x = M.byId(d, c.id);
    if (x?.keep) x.keep = { ...x.keep, since: Date.now() };
  });
}

/** Runs `run(value)` for the only entry, or lets the user pick one of several (e.g. which number to call). */
function pick(anchor, list, run) {
  if (list.length === 1) return run(list[0].v);
  menu(anchor, list.map((e) => ({ label: `${labelText(e.l)}  ${e.v}`, onClick: () => run(e.v) })));
}

/** Draws the detail of contact `id` into `host`. Returns false when the contact doesn't exist (any more). */
export function drawDetail(host, id, app, { page } = {}) {
  const d = data(), c = M.byId(d, id);
  if (!c) return false;
  const order = d.prefs.order, name = contactName(c, order);
  const keepScroll = host.querySelector('.ct-dscroll')?.scrollTop || 0;
  page?.setTitle(name);

  // ——— hero: picture, name, the lines under it ———
  const lines = [];
  const phon = [c.pfirst, c.pmiddle, c.plast].filter(Boolean).join(' ');
  if (phon) lines.push(h('div', { class: 'ct-dline' }, phon));
  if (c.nick) lines.push(h('div', { class: 'ct-dline' }, `“${c.nick}”`));
  const role = [c.job, c.dept].filter(Boolean).join(' · ');
  if (role) lines.push(h('div', { class: 'ct-dline' }, role));
  if (c.company && !c.isCo) lines.push(h('div', { class: 'ct-dline' }, c.company));
  if (d.me === c.id) lines.push(h('div', { class: 'ct-dline ct-dme' }, t('contacts.myProfile')));
  const hero = h('div', { class: 'ct-dhero' }, avatarEl(c, { size: 112, order, cls: 'ct-dav' }), h('h2', { class: 'ct-dname' }, h('bdi', null, name)), ...lines);

  // ——— round actions ———
  const phones = c.phones || [], emails = c.emails || [];
  const act = (ic, label, list, run, direct) => h('button', { class: 'ct-act', disabled: !list.length, onClick: (e) => (direct ? run() : pick(e.currentTarget, list, run)) },
    h('span', { class: 'ct-act-ico', html: icon(ic, 24) }), h('span', { class: 'ct-act-label' }, label));
  const acts = h('div', { class: 'ct-acts' },
    act('ctPhone', t('contacts.call'), phones, (v) => { handOff('tel:' + telOf(v)); touched(c); }),
    act('ctMsg', t('contacts.message'), phones, (v) => { handOff('sms:' + telOf(v)); touched(c); }),
    act('ctVideo', t('contacts.video'), phones, () => { window.open('https://meet.google.com/new', '_blank', 'noopener'); touched(c); }, true),
    act('ctMail', t('contacts.email'), emails, (v) => { handOff('mailto:' + v); touched(c); }));

  // ——— detail cards ———
  const frow = ({ ic, value, label, ltr, onClick, trailing, copyText, multi }) => {
    const el = h('div', { class: ['ct-frow', onClick && 'clickable'], role: onClick ? 'button' : null, tabindex: onClick ? 0 : null, title: onClick ? null : t('contacts.rightCopy') },
      h('span', { class: 'ct-fico', html: ic ? icon(ic, 22) : '' }),
      h('span', { class: 'ct-ftext' }, h('span', { class: ['ct-fval', multi && 'multi'], dir: ltr ? 'ltr' : 'auto' }, value), label ? h('span', { class: 'ct-flbl' }, label) : null),
      trailing || null);
    if (onClick) {
      el.addEventListener('click', (e) => !e.target.closest('.ct-ftrail') && onClick(e));
      el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && !e.target.closest('.ct-ftrail') && (e.preventDefault(), onClick(e)));
    } else el.addEventListener('click', () => copy(copyText ?? value));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu(e, [{ label: t('contacts.copy'), icon: 'copy', onClick: () => copy(copyText ?? value) }]);
    });
    return el;
  };
  const trail = (ic, label, run) => h('button', { class: 'ct-ftrail', title: label, 'aria-label': label, html: icon(ic, 20), onClick: (e) => { e.stopPropagation(); run(); } });
  const cards = [];
  if (phones.length) cards.push(h('div', { class: 'ct-dcard' }, phones.map((e, i) => frow({
    ic: i ? '' : 'ctPhone', value: e.v, label: labelText(e.l), ltr: true,
    onClick: () => { handOff('tel:' + telOf(e.v)); touched(c); },
    trailing: trail('ctMsg', t('contacts.message'), () => { handOff('sms:' + telOf(e.v)); touched(c); }),
  }))));
  if (emails.length) cards.push(h('div', { class: 'ct-dcard' }, emails.map((e, i) => frow({
    ic: i ? '' : 'ctMail', value: e.v, label: labelText(e.l), ltr: true, onClick: () => { handOff('mailto:' + e.v); touched(c); },
  }))));
  const info = [];
  const nb = M.nextBirthday(c);
  if (c.bday) {
    const soon = nb && M.daysUntil(nb.date) <= 30 ? [whenText(nb.date), ageText(nb.age)].filter(Boolean).join(', ') : '';
    info.push(frow({ ic: 'ctCake', value: dayText(c.bday), label: [t('contacts.label.birthday'), soon].filter(Boolean).join(' · ') }));
  }
  for (const e of c.dates || []) info.push(frow({ ic: 'calendar', value: dayText(e.v), label: labelText(e.l) }));
  for (const e of c.addrs || []) {
    const v = [e.street, [e.zip, e.city].filter(Boolean).join(' '), e.region, e.country].filter(Boolean).join('\n');
    info.push(frow({ ic: 'location', value: v, label: labelText(e.l), multi: true }));
  }
  for (const e of c.urls || []) info.push(frow({ ic: 'globe', value: e.v, label: t('contacts.website'), ltr: true, onClick: () => window.open(webUrl(e.v), '_blank', 'noopener') }));
  for (const e of c.social || []) {
    const url = /^https?:/i.test(e.v) ? e.v : SOCIAL_URL[e.l] ? SOCIAL_URL[e.l] + encodeURIComponent(e.v.replace(/^@/, '')) : null;
    info.push(frow({ ic: 'link', value: e.v, label: labelText(e.l), ltr: true, onClick: url ? () => window.open(url, '_blank', 'noopener') : null }));
  }
  for (const e of c.related || []) {
    const other = d.items.find((x) => x.id !== c.id && M.displayName(x, order) === e.v);
    info.push(frow({ ic: 'user', value: e.v, label: labelText(e.l), onClick: other ? () => app.openContact(other.id) : null }));
  }
  if (c.isCo && (c.job || c.dept)) info.push(frow({ ic: 'ctCard', value: c.company, label: fieldName('company') }));
  if (c.note) info.push(frow({ ic: 'note', value: c.note, label: t('contacts.notes'), multi: true }));
  if (info.length) cards.push(h('div', { class: 'ct-dcard' }, info));

  const groups = d.groups.filter((g) => g.ids.includes(c.id));
  if (groups.length) cards.push(h('div', { class: 'ct-dcard' }, frow({ ic: 'ctGroup', value: groups.map((g) => g.name || t('contacts.untitledGroup')).join(', '), label: t('contacts.groups'), onClick: () => pickGroups(app, [c.id]) })));

  if (c.keep) {
    const bg = store.get(M.BG_KEY) || {};
    const last = Math.max(c.keep.since || 0, bg.touched?.[c.id] || 0);
    cards.push(h('div', { class: 'ct-dcard' }, frow({
      ic: 'ctWave', value: `${t('contacts.keep')} · ${keepText(c.keep)}`, label: t('contacts.keepLast', { when: fmtRelative(last) }),
      onClick: () => keepMenu(c),
      trailing: h('button', { class: 'ou-btn tonal ct-keepbtn', onClick: (e) => { e.stopPropagation(); mark(c); } }, t('contacts.markContacted')),
    })));
  }

  // ——— One UI's bottom bar ———
  const fav = d.favs.includes(c.id);
  const barBtn = (ic, label, onClick, cls) => h('button', { class: ['ct-dbar-btn', cls], onClick }, h('span', { html: icon(ic, 22) }), h('span', null, label));
  const bar = h('div', { class: 'ct-dbar' },
    barBtn(fav ? 'starFill' : 'star', t('contacts.favourite'), () => {
      mutate((x) => { x.favs = fav ? x.favs.filter((y) => y !== c.id) : [...x.favs, c.id]; });
      toast(fav ? t('contacts.favRemoved') : t('contacts.favAdded'));
    }, fav && 'on'),
    barBtn('edit', t('contacts.edit'), () => app.editContact(c.id)),
    barBtn('share', t('contacts.share'), (e) => menu(e.currentTarget, [
      { label: t('contacts.shareVcf'), icon: 'ctCard', onClick: () => shareContacts([c.id]) },
      { label: t('contacts.shareText'), icon: 'copy', onClick: () => copy(contactText(c)) },
    ])),
    barBtn('more', t('contacts.moreBtn'), (e) => menu(e.currentTarget, [
      { label: t('contacts.addToGroup'), icon: 'ctGroup', onClick: () => pickGroups(app, [c.id]) },
      { label: t('contacts.keep'), icon: 'ctWave', onClick: () => keepMenu(c) },
      d.me !== c.id ? { label: t('contacts.setProfile'), icon: 'user', onClick: () => mutate((x) => { x.me = c.id; }) } : null,
      '-',
      { label: t('contacts.delete'), icon: 'trash', danger: true, onClick: () => app.deleteContacts([c.id]) },
    ], { align: 'end' })));

  const scroll = h('div', { class: 'ct-dscroll scroll' }, hero, acts, ...cards);
  host.replaceChildren(h('div', { class: 'ct-detail' }, scroll, bar));
  scroll.scrollTop = keepScroll;
  if (page) {
    // the page's small title appears once the big name has scrolled away
    const sync = () => page.el.classList.toggle('ct-scrolled', scroll.scrollTop > 150);
    scroll.addEventListener('scroll', sync, { passive: true });
    sync();
  }
  return true;
}

function mark(c) {
  mutate((d) => {
    const x = M.byId(d, c.id);
    if (x?.keep) x.keep = { ...x.keep, since: Date.now() };
  });
  toast(t('contacts.markedContacted'));
}

async function keepMenu(c) {
  const cur = c.keep ? `${c.keep.n}${c.keep.u}` : 'off';
  const v = await choose(t('contacts.keep'), [{ value: 'off', label: t('common.off') }, ...KEEP.map(([n, u]) => ({ value: `${n}${u}`, label: keepText({ n, u }) }))], cur);
  if (v == null || v === cur) return;
  mutate((d) => {
    const x = M.byId(d, c.id);
    if (!x) return;
    if (v === 'off') delete x.keep;
    else x.keep = { n: parseInt(v, 10), u: v.slice(-1), since: x.keep?.since || Date.now() };
  });
}

addStrings({
  en: {
    'contacts.message': 'Message',
    'contacts.video': 'Video call',
    'contacts.email': 'Email',
    'contacts.website': 'Website',
    'contacts.notes': 'Notes',
    'contacts.favourite': 'Favourite',
    'contacts.favAdded': 'Added to Favourites',
    'contacts.favRemoved': 'Removed from Favourites',
    'contacts.moreBtn': 'More',
    'contacts.copy': 'Copy',
    'contacts.copied': 'Copied to clipboard',
    'contacts.copyFail': 'Couldn’t copy',
    'contacts.rightCopy': 'Click to copy',
    'contacts.shareVcf': 'vCard file (.vcf)',
    'contacts.shareText': 'Copy as text',
    'contacts.setProfile': 'Set as my profile',
    'contacts.keep': 'Keep in touch',
    'contacts.keepW1': 'Every week',
    'contacts.keepWn': 'Every {n} weeks',
    'contacts.keepM1': 'Every month',
    'contacts.keepMn': 'Every {n} months',
    'contacts.keepY': 'Every year',
    'contacts.keepLast': 'Last contact {when}',
    'contacts.markContacted': 'Contacted',
    'contacts.markedContacted': 'Marked as contacted',
  },
  ar: {
    'contacts.message': 'رسالة',
    'contacts.video': 'مكالمة فيديو',
    'contacts.email': 'البريد الإلكتروني',
    'contacts.website': 'موقع الويب',
    'contacts.notes': 'ملاحظات',
    'contacts.favourite': 'المفضلة',
    'contacts.favAdded': 'تمت الإضافة إلى المفضلة',
    'contacts.favRemoved': 'تمت الإزالة من المفضلة',
    'contacts.moreBtn': 'المزيد',
    'contacts.copy': 'نسخ',
    'contacts.copied': 'تم النسخ إلى الحافظة',
    'contacts.copyFail': 'تعذر النسخ',
    'contacts.rightCopy': 'انقر للنسخ',
    'contacts.shareVcf': 'ملف vCard ‏(.vcf)',
    'contacts.shareText': 'نسخ كنص',
    'contacts.setProfile': 'تعيين كملفي الشخصي',
    'contacts.keep': 'البقاء على تواصل',
    'contacts.keepW1': 'كل أسبوع',
    'contacts.keepWn': 'كل {n} أسابيع',
    'contacts.keepM1': 'كل شهر',
    'contacts.keepMn': 'كل {n} أشهر',
    'contacts.keepY': 'كل سنة',
    'contacts.keepLast': 'آخر تواصل {when}',
    'contacts.markContacted': 'تم التواصل',
    'contacts.markedContacted': 'تم وضع علامة «تم التواصل»',
  },
});
