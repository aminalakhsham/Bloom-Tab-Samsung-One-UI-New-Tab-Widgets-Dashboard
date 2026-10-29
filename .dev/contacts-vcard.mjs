// Fast checks of the Contacts vCard reader/writer and model (no browser), ported from Liquid Tab: Apple, Android/Outlook
// 2.1 and 4.0 cards, round trips with Arabic names and photos, folded lines, several cards per file, sections and the
// letter index, birthdays, Keep in touch, duplicates and merge, the Recycle bin, Samsung's one-letter avatars.
// usage: node .dev/contacts-vcard.mjs   (exits 1 on failure)
import { parse, serialize, serializeAll, fold, decodeBytes } from '../js/contacts/vcard.js';
import * as M from '../js/contacts/model.js';
import * as O from '../js/contacts/organize.js';

let bad = 0, n = 0;
const ok = (cond, what, extra = '') => { n++; if (!cond) { bad++; console.log('FAIL', what, extra); } else console.log('ok  ', what); };
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Uint8Array) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const eq = (a, b) => canon(a) === canon(b);

// ---------------------------------------------------------------- an iPhone export, written by hand like iOS 17 does it
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const apple = [
  'BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Apple Inc.//iPhone OS 17.4//EN',
  'N:Appleseed;John;Quincy;Dr.;Jr.', 'FN:Dr. John Quincy Appleseed Jr.', 'NICKNAME:Johnny',
  'X-PHONETIC-FIRST-NAME:Jon', 'ORG:Apple Inc.;Design', 'TITLE:Engineer',
  'EMAIL;type=INTERNET;type=HOME;type=pref:john@example.com',
  'item1.EMAIL;type=INTERNET:john@icloud.com', 'item1.X-ABLabel:iCloud',
  'TEL;type=CELL;type=VOICE;type=pref:+1 (408) 555-0100',
  'TEL;type=IPHONE;type=CELL;type=VOICE:+1 (408) 555-0101',
  'TEL;type=WORK;type=FAX:+1 (408) 555-0199',
  'item2.TEL:+1 (408) 555-0150', 'item2.X-ABLabel:Gym',
  'item3.ADR;type=HOME;type=pref:;;1 Infinite Loop\\nBuilding 4;Cupertino;CA;95014;United States', 'item3.X-ABADR:us',
  'item4.URL;type=pref:https://example.com/john', 'item4.X-ABLabel:_$!<HomePage>!$_',
  'BDAY:1980-06-15',
  'item5.X-ABDATE;type=pref:2010-09-01', 'item5.X-ABLabel:_$!<Anniversary>!$_',
  'item6.X-ABRELATEDNAMES;type=pref:Jane Appleseed', 'item6.X-ABLabel:_$!<Spouse>!$_',
  'X-SOCIALPROFILE;type=twitter;x-user=johnappleseed:x-apple:johnappleseed',
  'NOTE:Met at WWDC\\, 2019.\\nLikes coffee; black.',
  'PHOTO;ENCODING=b;TYPE=JPEG:' + PNG.slice(0, 40), ' ' + PNG.slice(40),
  'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'N:;;;;', 'FN:Acme Corp', 'ORG:Acme Corp;', 'X-ABShowAs:COMPANY', 'TEL;type=MAIN:800-555-0000', 'BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-15', 'END:VCARD',
].join('\r\n');
const [john, acme] = parse(apple);
ok(john && john.first === 'John' && john.last === 'Appleseed' && john.middle === 'Quincy' && john.prefix === 'Dr.' && john.suffix === 'Jr.', 'Apple card: structured name');
ok(john.nick === 'Johnny' && john.pfirst === 'Jon' && john.company === 'Apple Inc.' && john.dept === 'Design' && john.job === 'Engineer', 'Apple card: nickname, phonetic, company, department, job');
ok(eq(john.emails, [{ l: 'home', v: 'john@example.com' }, { l: 'iCloud', v: 'john@icloud.com' }]), 'Apple card: email labels (home, iCloud from X-ABLabel)', JSON.stringify(john.emails));
ok(eq(john.phones.map(p => p.l), ['mobile', 'iPhone', 'workfax', 'Gym']), 'Apple card: phone labels incl. custom', JSON.stringify(john.phones));
ok(john.addrs?.[0]?.street === '1 Infinite Loop\nBuilding 4' && john.addrs[0].city === 'Cupertino' && john.addrs[0].zip === '95014' && john.addrs[0].l === 'home', 'Apple card: address with two street lines');
ok(eq(john.urls, [{ l: 'homepage', v: 'https://example.com/john' }]), 'Apple card: homepage URL');
ok(john.bday === '1980-06-15' && eq(john.dates, [{ l: 'anniversary', v: '2010-09-01' }]), 'Apple card: birthday and anniversary');
ok(eq(john.related, [{ l: 'spouse', v: 'Jane Appleseed' }]) && eq(john.social, [{ l: 'Twitter', v: 'johnappleseed' }]), 'Apple card: related name and social profile');
ok(john.note === 'Met at WWDC, 2019.\nLikes coffee; black.', 'Apple card: escaped note', JSON.stringify(john.note));
ok(john._photo?.bytes?.length === 70 && john._photo.bytes[1] === 0x50 && john._photo.type === 'image/jpeg', 'Apple card: folded base64 photo', john._photo?.bytes?.length);
ok(acme.isCo && acme.company === 'Acme Corp' && acme.bday === '--03-15' && M.displayName(acme) === 'Acme Corp', 'company card, birthday without a year (1604)');

// ---------------------------------------------------------------- vCard 2.1 from Android / Outlook: quoted-printable Arabic, bare types, base64 photo block
const qp = s => [...new TextEncoder().encode(s)].map(b => '=' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
const ar = 'سارة', arLast = 'الأحمد';
const v21 = [
  'BEGIN:VCARD', 'VERSION:2.1',
  `N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:${qp(arLast)};${qp(ar)};;;`,
  `FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:${qp(ar + ' ').slice(0, 30)}=`, `${qp(ar + ' ').slice(30)}${qp(arLast)}`,
  'TEL;CELL;PREF:+966 50 123 4567', 'TEL;HOME:011 456 7890', 'EMAIL;INTERNET;WORK:sara@example.sa',
  `NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:${qp('صديقة من الجامعة')}`,
  'BDAY:19920304',
  'PHOTO;ENCODING=BASE64;JPEG:' + PNG.slice(0, 30), PNG.slice(30, 60), PNG.slice(60), '',
  'END:VCARD',
  'BEGIN:VCARD', 'VERSION:2.1', 'N;CHARSET=WINDOWS-1256;ENCODING=QUOTED-PRINTABLE:=DA=E1=ED;;;;', 'END:VCARD',
].join('\r\n');
const [sara, ali] = parse(v21);
ok(sara.first === ar && sara.last === arLast, '2.1: quoted-printable UTF-8 Arabic name', JSON.stringify([sara.first, sara.last]));
ok(eq(sara.phones, [{ l: 'mobile', v: '+966 50 123 4567' }, { l: 'home', v: '011 456 7890' }]) && eq(sara.emails, [{ l: 'work', v: 'sara@example.sa' }]), '2.1: bare TYPE words');
ok(sara.note === 'صديقة من الجامعة' && sara.bday === '1992-03-04', '2.1: QP note, compact birthday');
ok(sara._photo?.bytes?.length === 70, '2.1: base64 photo continued without indentation', sara._photo?.bytes?.length);
ok(ali?.last === 'علي', '2.1: Windows-1256 quoted-printable', JSON.stringify(ali));

// ---------------------------------------------------------------- vCard 4.0
const v4 = ['BEGIN:VCARD', 'VERSION:4.0', 'KIND:individual', 'FN:Zoë Müller', 'N:Müller;Zoë;;;', 'TEL;VALUE=uri;TYPE="voice,cell";PREF=1:tel:+49-30-1234567', 'TEL;TYPE=work:+49 30 7654321',
  'EMAIL;TYPE=work:zoe@example.de', 'BDAY:--0229', 'ANNIVERSARY:20150620', 'RELATED;TYPE=friend;VALUE=text:Max', 'RELATED;TYPE=friend:urn:uuid:03a0e51f-d1aa-4385-8a53-e29025acd8af',
  'PHOTO:data:image/png;base64,' + PNG, 'END:VCARD'].join('\n');
const [zoe] = parse(v4);
ok(zoe.first === 'Zoë' && zoe.last === 'Müller' && eq(zoe.phones, [{ l: 'mobile', v: '+49-30-1234567' }, { l: 'work', v: '+49 30 7654321' }]), '4.0: quoted TYPE list and tel: URI');
ok(zoe.bday === '--02-29' && eq(zoe.dates, [{ l: 'anniversary', v: '2015-06-20' }]) && eq(zoe.related, [{ l: 'friend', v: 'Max' }]), '4.0: --MMDD birthday, ANNIVERSARY, RELATED text only');
ok(zoe._photo?.type === 'image/png' && zoe._photo.bytes.length === 70, '4.0: data: URI photo');
const fnOnly = parse('BEGIN:VCARD\nVERSION:3.0\nFN:Lina Haddad\nEND:VCARD')[0];
ok(fnOnly.first === 'Lina' && fnOnly.last === 'Haddad', 'a card with only FN is split into first and last');
ok(parse('garbage\nBEGIN:VCARD\nEND:VCARD\nBEGIN:VCARD\nVERSION:3.0\nN:X;Y;;;\nEND:VCARD').length === 1, 'empty and broken cards are skipped');
ok(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])) === 'A' && decodeBytes(new Uint8Array([0xe9])) === 'é' && decodeBytes(new Uint8Array([0xff, 0xfe, 0x41, 0])) === 'A', 'file text: UTF-8 BOM, Windows-1252, UTF-16');

// ---------------------------------------------------------------- round trips
const strip = c => { const o = { ...c }; delete o._photo; delete o.id; delete o.created; delete o.updated; return o; };
for (const c of [john, acme, sara, zoe]) {
  const back = parse(serialize({ ...c, id: 'x' }, { photo: c._photo ? { type: 'JPEG', b64: Buffer.from(c._photo.bytes).toString('base64') } : null }))[0];
  ok(eq(strip(back), strip(c)), 'round trip: ' + (M.displayName(c) || c.company), JSON.stringify([strip(back), strip(c)]));
  if (c._photo) ok(eq([...back._photo.bytes], [...c._photo.bytes]), 'round trip photo: ' + M.displayName(c));
}
const long = { id: 'l', first: 'عبد الرحمن', last: 'بن عبد العزيز آل سعود', note: 'ملاحظة طويلة '.repeat(20) + '😀👍🏽', phones: [{ l: 'mobile', v: '+966 55 000 0000' }] };
const out = serialize(long);
ok(out.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), 'lines are folded to 75 octets');
ok(!/�/.test(new TextDecoder().decode(new TextEncoder().encode(out))), 'folding never splits a UTF-8 character');
ok(eq(strip(parse(out)[0]), strip(M.normContact(long))), 'round trip: long Arabic note with emoji', canon([strip(parse(out)[0]), strip(M.normContact(long))]));
const many = serializeAll([john, sara, zoe].map((c, i) => ({ ...c, id: 'i' + i })));
ok(parse(many).length === 3 && (many.match(/BEGIN:VCARD/g) || []).length === 3, 'several cards in one file');
ok(fold('x'.repeat(200)).split('\r\n ').every((l, i) => l.length === (i ? (l.length <= 74 ? l.length : -1) : 75)), 'fold keeps 75 then 74');

// ---------------------------------------------------------------- model: names, sections, search
ok(M.displayName({ first: 'John', last: 'Appleseed' }, 'last') === 'Appleseed John' && M.displayName({ first: '小明', last: '王' }) === '王小明', 'display order and CJK names');
ok(M.initials({ first: 'john', last: 'appleseed' }) === 'JA' && M.initials({ first: 'سارة', last: 'أحمد' }) === 'س‌أ' && M.initials({ company: 'Acme' }) === 'A' && M.initials({ first: 'نورة', last: 'الحربي' }) === 'ن\u200cح', 'initials (Arabic kept apart, without the article)');
ok(O.sectionOf('Émile', 'en') === 'E' && O.sectionOf('Ñandu', 'es') === 'Ñ' && O.sectionOf('Çelik', 'tr') === 'Ç' && O.sectionOf('Çelik', 'en') === 'C', 'sections: accents folded, Ñ and Ç kept where the alphabet has them');
ok(O.sectionOf('أحمد', 'ar') === 'ا' && O.sectionOf('Юлия', 'ru') === 'Ю' && O.sectionOf('김민준', 'ko') === 'ㄱ' && O.sectionOf('サトウ', 'ja') === 'さ' && O.sectionOf('王', 'zh') === 'W' && O.sectionOf('12', 'en') === '#', 'sections: Arabic, Cyrillic, Hangul, kana, pinyin, digits');
const secs = O.sections([{ id: 1, first: 'Zed', last: 'Brown' }, { id: 2, first: 'Amy', last: 'Adams' }, { id: 3, first: 'سارة', last: 'أحمد' }, { id: 4, company: '3M', isCo: true }, { id: 5, first: 'Bob', last: 'Brown' }], { sort: 'last', lang: 'ar' });
ok(eq(secs.map(s => s.key), ['ا', 'A', 'B', '#']) && eq(secs[2].items.map(c => c.id), [5, 1]), 'sections in index order (Arabic UI: Arabic letters first), sorted by last name', JSON.stringify(secs.map(s => [s.key, s.items.map(c => c.id)])));
ok(O.indexLetters('ar')[0] === 'ا' && O.indexLetters('ar').at(-1) === '#' && O.indexLetters('en').length === 27, 'index letters per language');
const c1 = { id: 'a', first: 'أحمد', last: 'علي', phones: [{ l: 'mobile', v: '+966 (50) 111-2233' }], emails: [{ l: 'work', v: 'ahmad@corp.com' }], company: 'Globex', note: 'Loves chess' };
ok(M.match(c1, 'احمد').score >= 90 && M.match(c1, '١١١٢٢').field === 'phones' && M.match(c1, 'corp.com').field === 'emails' && M.match(c1, 'chess').field === 'note' && M.match(c1, 'glob').field === 'company' && !M.match(c1, 'zzz').score, 'search: folded Arabic name, phone digits, email, note, company');

// ---------------------------------------------------------------- birthdays, Keep in Touch, duplicates
const data = M.norm({ items: [{ id: 'b1', first: 'Sara', bday: '1995-10-20' }, { id: 'b2', first: 'Leap', bday: '2000-02-29' }, { id: 'b3', first: 'NoYear', bday: '--01-02' }, { id: 'b4', first: 'Born', bday: '2027-05-01' }] });
const bs = M.birthdaysBetween(data, new Date(2026, 9, 1), new Date(2027, 2, 1));
ok(eq(bs.map(b => [b.id, b.date.getMonth() + 1 + '/' + b.date.getDate(), b.age]), [['b1', '10/20', 31], ['b3', '1/2', null], ['b2', '2/28', 27]]), 'birthdays between dates: age, no year, Feb 29 on Feb 28', JSON.stringify(bs));
ok(!M.birthdaysBetween(data, new Date(2026, 4, 1), new Date(2026, 4, 2)).length, 'no birthday before the person is born');
const al = M.birthdayAlerts(data, new Date(2026, 9, 20), new Date(2026, 9, 21));
ok(al.length === 1 && new Date(al[0].at).getHours() === 9, 'birthday alert at 9:00 on the day');
const al2 = M.birthdayAlerts({ ...data, prefs: { alert: 1, alertTime: '08:30' } }, new Date(2026, 9, 19), new Date(2026, 9, 20));
ok(al2.length === 1 && new Date(al2[0].at).getDate() === 19 && new Date(al2[0].at).getMinutes() === 30, 'birthday alert a day before at 8:30');
const since = +new Date(2026, 0, 10, 15);
ok(new Date(M.keepDue({ keep: { n: 2, u: 'w', since } })).getDate() === 24 && new Date(M.keepDue({ keep: { n: 1, u: 'm', since } })).getMonth() === 1, 'Keep in Touch: every 2 weeks / every month');
ok(new Date(M.keepDue({ keep: { n: 2, u: 'w', since } }, 0, +new Date(2026, 0, 24, 10))).getDate() === 7, 'Keep in Touch: the next one after a reminder was shown');
const dd = M.norm({ items: [{ id: 'd1', first: 'Sam', last: 'Lee', phones: [{ l: 'mobile', v: '555 1234' }] }, { id: 'd2', first: 'sam', last: 'lee', emails: [{ l: 'home', v: 'sam@x.com' }], bday: '1990-01-01' }, { id: 'd3', first: 'Samuel', emails: [{ l: 'work', v: 'SAM@x.com' }] }, { id: 'd4', first: 'Other' }], favs: ['d3'], me: 'd2', lists: [{ id: 'L', name: 'F', ids: ['d1', 'd4'] }] });
const groups = O.findDuplicates(dd);
ok(groups.length === 1 && eq(groups[0].sort(), ['d1', 'd2', 'd3']), 'duplicates: same name or shared email', JSON.stringify(groups));
ok(!O.findDuplicates({ ...dd, dupSkip: ['d1|d2', 'd2|d3'] }).length, 'duplicates: pairs kept apart are skipped');
const merged = O.applyMerge(structuredClone(dd), groups[0]);
const m0 = merged.items.find(c => c.id !== 'd4');
ok(merged.items.length === 2 && m0.phones.length === 1 && m0.emails.length === 1 && m0.bday === '1990-01-01', 'merge keeps every field once (emails compared case-insensitively)', JSON.stringify(m0));
ok(merged.favs[0] === m0.id && merged.me === m0.id && merged.groups[0].ids.includes(m0.id), 'merge: Favourites, My profile and groups follow');
ok(M.norm({ items: [null, 5, { id: 'x', first: 7, phones: 'nope', bday: '2023-02-29' }], favs: ['zz'], me: 'zz' }).items.length === 1 && M.norm(null).items.length === 0, 'corrupt data is tolerated');

// ---------------------------------------------------------------- Bloom Tab additions: avatars, phone duplicates, Recycle bin
ok(M.initial({ first: 'sara', last: 'Ahmed' }) === 'S' && M.initial({ first: 'Sara', last: 'Ahmed' }, 'last') === 'A' && M.initial({ first: 'نورة', last: 'الحربي' }) === 'ن' && M.initial({ company: 'acme', isCo: true }) === 'A' && M.initial({ emails: [{ l: 'home', v: 'x@y.z' }] }) === '' && M.initial({ first: '小明', last: '王' }) === '王', 'one-letter avatar: first letter as shown, none for an email-only card');
const pd = M.norm({ items: [{ id: 'p1', first: 'Ali', phones: [{ l: 'mobile', v: '+966 50 123 4567' }] }, { id: 'p2', first: 'Abu Omar', phones: [{ l: 'home', v: '050-123-4567' }] }, { id: 'p3', first: 'Zed', phones: [{ l: 'home', v: '123' }] }] });
ok(eq(O.findDuplicates(pd).map((g) => g.sort()), [['p1', 'p2']]), 'duplicates: a shared phone number (last 9 digits)');
const now = Date.now();
const tr = O.trashContacts(structuredClone(dd), ['d1', 'd2'], now);
ok(tr.items.length === 2 && tr.trash.length === 2 && tr.me === null && !tr.groups[0].ids.includes('d1') && tr.trash.find((x) => x.c.id === 'd2').me, 'delete moves contacts to the Recycle bin and remembers My profile and groups');
const back = O.restoreContacts(structuredClone(tr), ['d1', 'd2']);
ok(back.items.length === 4 && back.me === 'd2' && back.groups[0].ids.includes('d1') && !back.trash.length, 'restore puts them back with My profile and groups');
const old = M.norm({ ...tr, trash: [{ ...tr.trash[0], at: now - 31 * 864e5 }, tr.trash[1]] });
ok(old.trash.length === 1 && O.daysLeft(old.trash[0], now) === 30 && O.daysLeft({ at: now - 29.5 * 864e5 }, now) === 1, 'Recycle bin keeps 30 days');
ok(M.norm({ items: [{ id: 'a', first: 'A' }], lists: [{ id: 'g', name: 'G', ids: ['a', 'zz'] }] }).groups[0].ids.length === 1, 'old "lists" become groups');
ok(M.daysUntil(new Date(2026, 9, 28), new Date(2026, 9, 26, 23)) === 2, 'days until a date');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
