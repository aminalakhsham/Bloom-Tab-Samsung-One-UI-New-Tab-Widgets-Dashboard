// Finder's natural language (ported from Liquid Tab's js/nlp.js and search.js): dates and times in a sentence ("call
// mom tomorrow at 6pm", "lunch with Sara Friday 1pm", "ذكرني بالاتصال بأمي الساعة 6 مساءً"), durations ("1h 30m",
// "ساعتين"), date questions ("days until Dec 25", "what day is…", "كم يوم حتى رمضان"), cities for "time in…" (also
// written in Arabic) and Arabic folding (Arabic-Indic digits, short vowels, hamza forms). Pure: no DOM, no storage, so
// .dev/finder-nlp.mjs runs it in plain node.

const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ——— folding ———
/** Matching copy of `str`: Arabic-Indic digits become 0-9 and Arabic short vowels (غدًا, مساءً) are dropped.
 *  map[i] is the index in `str` of character i, so a match can be cut out of the user's own text. */
function fold(str) {
  let out = '';
  const map = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if ((c >= 0x64b && c <= 0x652) || c === 0x640) continue;
    out += c >= 0x660 && c <= 0x669 ? String(c - 0x660) : c >= 0x6f0 && c <= 0x6f9 ? String(c - 0x6f0) : str[i];
    map.push(i);
  }
  map.push(str.length);
  return [out, map];
}
/** For matching typed commands: ٠-٩ → 0-9, no Arabic short vowels ("شغّل" → "شغل", "مؤقت ١٠" → "مؤقت 10"). */
export const foldArabic = (str) => fold(String(str ?? ''))[0];
/** foldArabic(), lower case, and the hamza forms, alef maqsura and ta marbuta people type either way unified
 *  ("أخذت" = "اخذت", "حتى" = "حتي", "قهوة" = "قهوه"). */
export const foldCmd = (s) => foldArabic(s).toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();

// ——— dates and times in a sentence ———
const DAYS = [
  ['sunday', 'sun', 'الأحد', 'الاحد', 'domingo', 'dimanche', 'sonntag', 'domenica', 'воскресенье', 'pazar', 'minggu'],
  ['monday', 'mon', 'الاثنين', 'الإثنين', 'lunes', 'lundi', 'montag', 'lunedì', 'lunedi', 'segunda', 'segunda-feira', 'понедельник', 'pazartesi', 'senin'],
  ['tuesday', 'tue', 'tues', 'الثلاثاء', 'martes', 'mardi', 'dienstag', 'martedì', 'martedi', 'terça', 'terça-feira', 'вторник', 'salı', 'selasa'],
  ['wednesday', 'wed', 'الأربعاء', 'الاربعاء', 'miércoles', 'miercoles', 'mercredi', 'mittwoch', 'mercoledì', 'mercoledi', 'quarta', 'quarta-feira', 'среда', 'среду', 'çarşamba', 'rabu'],
  ['thursday', 'thu', 'thur', 'thurs', 'الخميس', 'jueves', 'jeudi', 'donnerstag', 'giovedì', 'giovedi', 'quinta', 'quinta-feira', 'четверг', 'perşembe', 'kamis'],
  ['friday', 'fri', 'الجمعة', 'الجمعه', 'viernes', 'vendredi', 'freitag', 'venerdì', 'venerdi', 'sexta', 'sexta-feira', 'пятница', 'пятницу', 'cuma', 'jumat', "jum'at"],
  ['saturday', 'sat', 'السبت', 'sábado', 'sabado', 'samedi', 'samstag', 'sabato', 'суббота', 'субботу', 'cumartesi', 'sabtu'],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Arabic month names: Egypt/Gulf names, then the Levant/Iraq names
const AR_MONTHS = [['يناير', 'كانون الثاني'], ['فبراير', 'شباط'], ['مارس', 'آذار', 'اذار'], ['أبريل', 'ابريل', 'إبريل', 'نيسان'], ['مايو', 'أيار', 'ايار'], ['يونيو', 'حزيران'],
  ['يوليو', 'تموز'], ['أغسطس', 'اغسطس', 'آب'], ['سبتمبر', 'أيلول', 'ايلول'], ['أكتوبر', 'اكتوبر', 'تشرين الأول', 'تشرين الاول'], ['نوفمبر', 'تشرين الثاني'], ['ديسمبر', 'كانون الأول', 'كانون الاول']];
const WORD_TIMES = { noon: [12, 0], midday: [12, 0], midnight: [0, 0], morning: [9, 0], afternoon: [14, 0], evening: [18, 0], tonight: [20, 0], night: [20, 0],
  'الظهر': [12, 0], 'العصر': [15, 30], 'الصباح': [9, 0], 'صباحا': [9, 0], 'المساء': [18, 0], 'مساء': [18, 0], 'الليلة': [20, 0], 'الفجر': [5, 0] };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dayAlt = DAYS.flat().map(esc).sort((a, b) => b.length - a.length).join('|');
const arMonthAlt = AR_MONTHS.flat().map(esc).sort((a, b) => b.length - a.length).join('|');
// end of an Arabic word (\b only knows ASCII letters)
const END = '(?=[\\s.,!?؟،]|$)';
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/**
 * Finds a date and/or time in `text`.
 * Returns null, or { title, date: 'YYYY-MM-DD', time: 'HH:MM' | '', when: Date }.
 */
export function parseWhen(text, now = new Date()) {
  if (CJK.test(text)) return parseCJK(text, now);
  // s keeps the user's text for the title; matching runs on the folded copy n
  let s = ' ' + String(text).trim() + ' ';
  let [n, map] = fold(s);
  let day = null, time = null, found = false, night = false;
  const cut = (m) => {
    s = s.slice(0, map[m.index]) + ' ' + s.slice(map[m.index + m[0].length]);
    [n, map] = fold(s);
    found = true;
  };
  const take = (re) => {
    const m = n.match(re);
    if (m) cut(m);
    return m;
  };
  const base = () => new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // relative: in 20 minutes / in 2 hours / in 3 days / in a week
  let m = take(new RegExp(`\\s(?:in|within|بعد|en|dans)\\s+(\\d+|an?|one)\\s*(min(?:ute)?s?|m|h(?:ou)?rs?|hours?|h|days?|d|weeks?|w|دقيق[ةه]|دقائق|ساع[ةه]|ساعات|يوم|أيام|ايام|أسابيع|اسابيع|أسبوع|اسبوع|minutos?|horas?|días?|heures?|jours?)${END}`, 'i'))
    // بعد ساعة / بعد ساعتين: Arabic says one and two with the noun alone
    || take(new RegExp(`\\sبعد\\s+(ساعت(?:ين|ان)|دقيقت(?:ين|ان)|يوم(?:ين|ان)|[أا]سبوع(?:ين|ان)|ساع[ةه]|دقيق[ةه]|يوم|[أا]سبوع)${END}`));
  if (m) {
    const dual = m.length === 2;
    const k = dual ? (/(ين|ان)$/.test(m[1]) ? 2 : 1) : /^\d+$/.test(m[1]) ? +m[1] : 1, u = (dual ? m[1] : m[2]).toLowerCase();
    const d = new Date(now);
    if (/^(m|min|دقي|دقا|minut)/.test(u)) d.setMinutes(d.getMinutes() + k);
    else if (/^(h|ساع|hora|heure)/.test(u)) d.setHours(d.getHours() + k);
    else if (/^(w|[أا]سب|[أا]ساب)/.test(u)) d.setDate(d.getDate() + 7 * k);
    else d.setDate(d.getDate() + k);
    day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (/^(m|h|دقي|دقا|ساع|minut|hora|heure)/.test(u)) time = [d.getHours(), d.getMinutes()];
  }

  // day words
  if (!day) {
    if ((m = take(/\s(?:the\s+)?day after tomorrow|\sبعد\s+غد[اه]?\s|\spasado mañana\s|\saprès-demain\s|\sübermorgen\s|\sdopodomani\s|\sdepois de amanhã\s|\sпослезавтра\s|\söbür gün\s|\slusa\s/i))) { day = base(); day.setDate(day.getDate() + 2); }
    else if ((m = take(/\s(?:tomorrow|tmrw|tmr|غد[اه]?|بكر[ةها]|mañana|demain|morgen|domani|amanhã|завтра|yarın|besok)\s/i))) { day = base(); day.setDate(day.getDate() + 1); }
    else if ((m = take(/\s(?:today|اليوم|hoy|aujourd'hui|heute|oggi|hoje|сегодня|bugün|hari ini)\s/i))) day = base();
    else if ((m = take(/\s(tonight)\s/i))) { day = base(); night = true; }
  }
  // weekday: (on|next|this)? friday
  if (!day && (m = take(new RegExp(`\\s(?:on\\s+|next\\s+|this\\s+|يوم\\s+|el\\s+|le\\s+|am\\s+|в\\s+|во\\s+|na\\s+|hari\\s+)?(${dayAlt})\\.?(?=\\s)`, 'i')))) {
    const want = DAYS.findIndex((names) => names.includes(m[1].toLowerCase()));
    day = base();
    let diff = (want - day.getDay() + 7) % 7;
    if (diff === 0 || /next/i.test(m[0])) diff = diff || 7;
    day.setDate(day.getDate() + diff);
  }
  // month day: "march 3", "3 march", "mar 3rd"
  if (!day && (m = take(new RegExp(`\\s(?:on\\s+)?(?:(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?|(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS.join('|')})[a-z]*)\\b`, 'i')))) {
    const mon = MONTHS.indexOf((m[1] || m[4]).toLowerCase().slice(0, 3)), dd = +(m[2] || m[3]);
    day = new Date(now.getFullYear(), mon, dd);
    if (day < base()) day.setFullYear(day.getFullYear() + 1);
  }
  // Arabic month names: "3 مارس", "مارس 3", "3 من مارس"
  if (!day && (m = take(new RegExp(`\\s(?:في\\s+|يوم\\s+)?(?:(\\d{1,2})\\s+(?:من\\s+)?(${arMonthAlt})|(${arMonthAlt})\\s+(\\d{1,2}))${END}`)))) {
    const mon = AR_MONTHS.findIndex((names) => names.includes(m[2] || m[3])), dd = +(m[1] || m[4]);
    day = new Date(now.getFullYear(), mon, dd);
    if (day < base()) day.setFullYear(day.getFullYear() + 1);
  }
  // numeric date: 3/14 or 14.3 (month first only with slashes in US-style locales)
  if (!day && (m = n.match(/\s(?:on\s+)?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?=\s)/))) {
    const usLike = /^en-(US|PH)|^en$/i.test(globalThis.navigator?.language || 'en-US');
    const a = +m[1], b = +m[2];
    const [mon, dd] = usLike && m[0].includes('/') ? [a, b] : [b, a];
    if (mon >= 1 && mon <= 12 && dd >= 1 && dd <= 31) {
      cut(m);
      day = new Date(m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : now.getFullYear(), mon - 1, dd);
      if (!m[3] && day < base()) day.setFullYear(day.getFullYear() + 1);
    }
  }

  // time: at 5, 5pm, 5:30 pm, 17:30, الساعة 5 مساءً, الساعة 1 ظهرًا (a bare number is not a time)
  if (!time && (m = n.match(/\s(at\s+|@\s*|الساع[ةه]\s+|a las\s+|à\s+|às\s+|alle\s+|um\s+|в\s+|saat\s+|pukul\s+|jam\s+)?(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|صباحا|صباح|مساء|ظهرا|ظهر|عصرا|ليلا|ص|م|uhr|h)?(?=\s)/i)) && (m[1] || m[3] || m[4])) {
    let h = +m[2];
    const mi = +(m[3] || 0), ap = (m[4] || '').toLowerCase();
    if (/^(pm|p\.m\.|م|مساء|ظهرا|ظهر|عصرا|ليلا)$/.test(ap) && h < 12) h += 12;
    if (/^(am|a\.m\.|ص|صباحا|صباح)$/.test(ap) && h === 12) h = 0;
    if (!ap && !m[3] && h >= 1 && h <= 7) h += 12; // "at 5" usually means 5 pm
    if (h < 24 && mi < 60) {
      cut(m);
      time = [h, mi];
    }
  }
  if (!time && (m = take(new RegExp(`\\s(?:at\\s+|in the\\s+|this\\s+)?(${Object.keys(WORD_TIMES).map(esc).join('|')})(?=\\s)`, 'i')))) time = WORD_TIMES[m[1].toLowerCase()] || WORD_TIMES[m[1]];

  // "at 6 tonight": an explicit time wins over the 8 pm default
  if (night) time = time ? [time[0] < 12 ? time[0] + 12 : time[0], time[1]] : [20, 0];
  if (!found || (!day && !time)) return null;
  if (!day) {
    day = base();
    if (time && time[0] * 60 + time[1] <= now.getHours() * 60 + now.getMinutes()) day.setDate(day.getDate() + 1);
  }
  const when = new Date(day);
  if (time) when.setHours(time[0], time[1], 0, 0);
  const title = s.replace(/\s+/g, ' ').replace(/\s(?:at|on|by|for|في|على|el|le|am)\s*$/i, '').replace(/^(?:at|on|by)\s/i, '').trim();
  return { title, date: dateKey(day), time: time ? `${pad(time[0])}:${pad(time[1])}` : '', when };
}

// Chinese, Japanese and Korean are written without spaces between words, so they get their own pass.
const CJK_DAYS = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6, 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
function parseCJK(text, now) {
  let s = text, day = null, time = null, m;
  const base = () => new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const take = (re) => {
    const x = s.match(re);
    if (x) s = s.replace(x[0], ' ');
    return x;
  };
  if (take(/后天|後天|明後日|あさって|모레/)) { day = base(); day.setDate(day.getDate() + 2); }
  else if (take(/明天|明日|あした|내일/)) { day = base(); day.setDate(day.getDate() + 1); }
  else if (take(/今天|今日|きょう|오늘/)) day = base();
  if (!day && (m = take(/(?:下)?(?:星期|周|週|礼拜|禮拜)([一二三四五六日天])|([月火水木金土日])曜日?|([월화수목금토일])요일/))) {
    const want = CJK_DAYS[m[1] || m[2] || m[3]];
    day = base();
    day.setDate(day.getDate() + ((want - day.getDay() + 7) % 7 || 7));
  }
  if ((m = take(/(上午|早上|中午|下午|晚上|今晚|午前|午後|夜|오전|오후|저녁|아침)?\s*(\d{1,2})\s*(?:[:：](\d{2})|[点點時时시])\s*(?:(\d{1,2})\s*[分분]|(半))?/))) {
    let h = +m[2];
    const mi = m[3] ? +m[3] : m[4] ? +m[4] : m[5] ? 30 : 0;
    if (/下午|晚上|今晚|午後|夜|오후|저녁/.test(m[1] || '') && h < 12) h += 12;
    if (h < 24 && mi < 60) time = [h, mi];
  }
  if (!day && !time) return null;
  if (!day) {
    day = base();
    if (time && time[0] * 60 + time[1] <= now.getHours() * 60 + now.getMinutes()) day.setDate(day.getDate() + 1);
  }
  const when = new Date(day);
  if (time) when.setHours(time[0], time[1], 0, 0);
  const title = s.replace(/[\s,，、]+/g, ' ').trim().replace(/^(?:に|で|を|에게|에)\s*/, '').trim();
  return { title, date: dateKey(day), time: time ? `${pad(time[0])}:${pad(time[1])}` : '', when };
}

// ——— commands ———
/** "5m", "1h 30m", "90 ثانية", "ساعتين", "نصف ساعة" → seconds, or null. A bare number is minutes. */
export function parseDuration(str) {
  let total = 0, any = false;
  // Arabic says one and two with the noun alone (ساعة, ساعتين) and has half and quarter hours
  str = foldArabic(str).replace(/نصف\s+ساع[ةه]/g, '30m').replace(/ربع\s+ساع[ةه]/g, '15m')
    .replace(/(?<![\d.]\s*)ساعت(?:ين|ان)/g, '2h').replace(/(?<![\d.]\s*)دقيقت(?:ين|ان)/g, '2m')
    .replace(/(?<![\d.]\s*)ساع[ةه](?![؀-ۿ])/g, '1h').replace(/(?<![\d.]\s*)دقيق[ةه](?![؀-ۿ])/g, '1m');
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|ساعات|ساع[ةه]|س|minutes?|mins?|m|دقائق|دقيق[ةه]|د|seconds?|secs?|s|ثوان[ي]?|ثاني[ةه]|ث)?(?![a-z؀-ۿ])/gi;
  let m;
  while ((m = re.exec(str))) {
    const n = parseFloat(m[1]), u = (m[2] || 'm').toLowerCase();
    any = true;
    if (/^(h|hr|hrs|hour|hours|ساعة|ساعه|ساعات|س)$/.test(u)) total += n * 3600;
    else if (/^(s|sec|secs|second|seconds|ثانية|ثانيه|ثوان|ثواني|ث)$/.test(u)) total += n;
    else total += n * 60;
  }
  return any ? total : null;
}

const REMIND = /^(?:remind me to|remind me about|remind me that|remind me|reminder:?|todo:?|to-do:?|ذكرني(?:\s+(?:بأن|بان|أن|ان)(?=\s))?|تذكير:?|recuérdame|rappelle-moi de|erinnere mich(?: daran)?,?|ricordami di|lembre-me de|напомни(?:ть)?(?: мне)?|hatırlat)(?:\s+|(?<=:)\s*)(.+)$/iu;
/**
 * "remind me to call mom at 6pm", "ذكرني بالاتصال بأمي الساعة 6 مساءً" → { title, when } (when: parseWhen's result or
 * null), or null when it isn't a reminder.
 */
export function parseReminder(q, now = new Date()) {
  const m = String(q).trim().match(REMIND);
  if (!m || !m[1].trim()) return null;
  const w = parseWhen(m[1], now);
  // ذكرني بالاتصال → الاتصال (Arabic writes "with" on the word)
  const title = (w?.title || m[1]).trim().replace(/^ب(?=ال)/, '').replace(/^(?:to|about|that)\s+/i, '').trim();
  return title ? { title, when: w } : null;
}

// ——— date questions ———
const HOLIDAYS = [
  [['christmas', 'xmas', 'christmas day', 'الكريسماس', 'الكريسمس', 'كريسماس'], { m: 12, d: 25 }],
  [["new year's day", 'new years day', "new year's", 'new years', 'new year', 'راس السنه', 'راس السنه الميلاديه', 'السنه الجديده'], { m: 1, d: 1 }],
  [["valentine's day", 'valentines day', "valentine's", 'valentines', 'عيد الحب'], { m: 2, d: 14 }],
  [['halloween', 'الهالوين', 'هالوين'], { m: 10, d: 31 }],
  [['ramadan', 'رمضان', 'شهر رمضان'], { hm: 9, hd: 1 }],
  [['eid', 'eid al-fitr', 'eid al fitr', 'eid ul fitr', 'eid ul-fitr', 'العيد', 'عيد الفطر'], { hm: 10, hd: 1 }],
  [['eid al-adha', 'eid al adha', 'eid ul adha', 'eid ul-adha', 'عيد الاضحي', 'الاضحي'], { hm: 12, hd: 10 }],
  [['islamic new year', 'hijri new year', 'muharram', 'راس السنه الهجريه', 'السنه الهجريه'], { hm: 1, hd: 1 }],
];
let hijriFmt;
/** The Umm al-Qura (Hijri) month and day of a date, or null where Intl has no Islamic calendar. */
export function hijriOf(d) {
  try {
    hijriFmt ||= new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric' });
    const p = Object.fromEntries(hijriFmt.formatToParts(d).map((x) => [x.type, x.value]));
    return { y: parseInt(p.year, 10), m: +p.month, d: +p.day };
  } catch {
    return null;
  }
}
function holiday(name, now) {
  const f = foldCmd(name).replace(/[?؟!.]+$/, '').replace(/^the\s+/, '').trim();
  const hit = HOLIDAYS.find(([names]) => names.some((x) => foldCmd(x) === f));
  if (!hit) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const h = hit[1];
  if (h.m) {
    const d = new Date(now.getFullYear(), h.m - 1, h.d);
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  // Hijri dates move every year: the next day (from today) whose Umm al-Qura date matches
  for (let i = 0; i < 400; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const x = hijriOf(new Date(d.getTime() + 12 * 3600e3));
    if (!x) return null;
    if (x.m === h.hm && x.d === h.hd) return d;
  }
  return null;
}

/** A plain date ("dec 25", "25 ديسمبر", "friday", "12/25/2027", "christmas", "رمضان") → that day at midnight, or null. */
export function parseDay(text, now = new Date()) {
  let s = String(text).trim().replace(/[?؟!.]+$/, '').replace(/^(?:on|the|is|it|يوم|في)\s+/i, '').trim();
  if (!s) return null;
  const hol = holiday(s, now);
  if (hol) return hol;
  // an explicit year ("march 3 2027", "3 مارس 2027") is taken out first and put back after
  let year = null;
  const ym = foldArabic(s).match(/(?:^|[\s,])((?:19|20)\d\d)$/);
  if (ym) {
    year = +ym[1];
    s = s.slice(0, s.length - ym[1].length).replace(/[\s,]+$/, '');
  }
  const w = parseWhen(s, now);
  if (!w || w.time || foldCmd(w.title).replace(/\b(?:of|the)\b|,/g, '').trim()) return null;
  const [y, m, d] = w.date.split('-').map(Number);
  return new Date(year ?? y, m - 1, d);
}

const UNTIL = /^(?:how many (?:days|weeks)|days?|how long|countdown)\s+(?:are\s+)?(?:left\s+)?(?:until|till|til|to|before)\s+(.+)$/i;
const SINCE = /^(?:how many days|days?|how long)\s+(?:has it been\s+)?since\s+(.+)$/i;
const AR_UNTIL = /^(?:كم\s+)?(?:يوم|ايام|باقي|بقي|الايام|عدد الايام)(?:\s+(?:باقي|بقي|متبقي|متبقيه))?\s*(?:حتي|علي|علي\s+|لـ?|الي|ل)\s*(.+)$/;
const WEEKDAY = /^(?:what|which)\s+day\s+(?:of the week\s+)?(?:is|was|will be|falls on|is it on)\s+(.+)$/i;
const AR_WEEKDAY = /^(?:(?:في\s+)?اي\s+يوم|ما\s+(?:هو\s+)?يوم|يوم\s+ايش)\s+(?:هو\s+|يكون\s+|يوافق\s+|سيكون\s+)?(.+)$/;
const OFFSET = /^(?:(?:what(?:'s| is| will be) the date|date)\s+)?(?:in\s+)?(\d+)\s+(days?|weeks?|months?|years?)\s*(from now|from today|later|after today)?$/i;
const AR_OFFSET = /^(?:(?:ما\s+)?(?:هو\s+)?التاريخ\s+)?بعد\s+(\d+)\s*(يوم|ايام|اسبوع|اسابيع|شهر|اشهر|شهور|سنه|سنوات|عام)$/;
const TODAY = /^(?:what(?:'s| is) (?:the )?date(?: today)?|today'?s date|date today|the date|date|what day is (?:it|today)|what(?:'s| is) today|تاريخ اليوم|ما تاريخ اليوم|ما هو تاريخ اليوم|التاريخ|التاريخ اليوم|اليوم كم|ما هو اليوم|اي يوم اليوم)$/i;
const WEEKNUM = /^(?:week number|what week is it|which week is it|current week|week no\.?|رقم الاسبوع|اي اسبوع نحن|في اي اسبوع نحن)$/i;
const HIJRI = /^(?:hijri date|hijri|islamic date|today in hijri|التاريخ الهجري|التاريخ الهجري اليوم|كم الهجري|هجري)$/i;

/**
 * Date questions → { kind, date, days } or null.
 *   until  — "days until Dec 25", "how long until christmas", "كم يوم حتى رمضان" (days ≥ 0, or negative when it passed)
 *   since  — "days since jan 1"
 *   weekday — "what day is dec 25", "أي يوم 25 ديسمبر"
 *   offset — "100 days from now", "in 3 weeks", "بعد 100 يوم"
 *   today / week / hijri — "what's the date", "week number", "التاريخ الهجري"
 */
export function parseDateQuestion(q, now = new Date()) {
  const raw = String(q).trim().replace(/[?؟]+$/, '').trim();
  const f = foldCmd(raw);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = (d) => Math.round((d - today) / 864e5);
  let m;
  if (TODAY.test(f)) return { kind: 'today', date: today, days: 0 };
  if (WEEKNUM.test(f)) return { kind: 'week', date: today, days: 0 };
  if (HIJRI.test(f)) return { kind: 'hijri', date: today, days: 0 };
  if ((m = raw.match(UNTIL) || foldArabic(raw).match(UNTIL)) || (m = f.match(AR_UNTIL))) {
    const d = parseDay(m[1], now);
    return d ? { kind: 'until', date: d, days: diff(d) } : null;
  }
  if ((m = raw.match(SINCE))) {
    let d = parseDay(m[1], now);
    // "since jan 1" means the last one, not the next
    if (d && d > today) d = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
    return d ? { kind: 'since', date: d, days: diff(d) } : null;
  }
  if ((m = raw.match(WEEKDAY)) || (m = f.match(AR_WEEKDAY))) {
    const d = parseDay(m[1], now);
    return d ? { kind: 'weekday', date: d, days: diff(d) } : null;
  }
  if ((m = f.match(OFFSET)) && (m[3] || /^(?:in|what|date)/.test(f))) {
    const n = +m[1], u = m[2][0];
    const d = new Date(today);
    if (u === 'd') d.setDate(d.getDate() + n);
    else if (u === 'w') d.setDate(d.getDate() + 7 * n);
    else if (u === 'm') d.setMonth(d.getMonth() + n);
    else d.setFullYear(d.getFullYear() + n);
    return n > 0 && n < 100000 ? { kind: 'offset', date: d, days: diff(d) } : null;
  }
  if ((m = f.match(AR_OFFSET))) {
    const n = +m[1], u = m[2];
    const d = new Date(today);
    if (/^(يوم|ايام)$/.test(u)) d.setDate(d.getDate() + n);
    else if (/^اسب|^اساب/.test(u)) d.setDate(d.getDate() + 7 * n);
    else if (/^(شهر|اشهر|شهور)$/.test(u)) d.setMonth(d.getMonth() + n);
    else d.setFullYear(d.getFullYear() + n);
    return n > 0 && n < 100000 ? { kind: 'offset', date: d, days: diff(d) } : null;
  }
  return null;
}

/** ISO 8601 week number. */
export function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  return Math.ceil(((x - Date.UTC(x.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

// ——— time in a city ———
// Time zone ids are English city names; these are the cities and countries people ask for that aren't one, plus their
// Arabic names (compared after foldCmd, so "دبى"/"دبي" and "الرياض"/"رياض" both work). Names are comma-separated.
const CITIES = {
  'Asia/Dubai': 'dubai,abu dhabi,sharjah,ajman,uae,emirates,united arab emirates,دبي,ابوظبي,ابو ظبي,الشارقه,عجمان,الامارات',
  'Asia/Riyadh': 'riyadh,jeddah,jedda,mecca,makkah,medina,madinah,dammam,khobar,saudi,saudi arabia,ksa,الرياض,جده,مكه,مكه المكرمه,المدينه,المدينه المنوره,الدمام,الخبر,السعوديه,المملكه',
  'Asia/Qatar': 'doha,qatar,الدوحه,قطر', 'Asia/Kuwait': 'kuwait,kuwait city,الكويت', 'Asia/Bahrain': 'manama,bahrain,المنامه,البحرين',
  'Asia/Muscat': 'muscat,oman,مسقط,سلطنه عمان', 'Asia/Amman': 'amman,jordan,الاردن', 'Asia/Beirut': 'beirut,lebanon,بيروت,لبنان',
  'Asia/Damascus': 'damascus,syria,aleppo,دمشق,سوريا,حلب', 'Asia/Baghdad': 'baghdad,iraq,basra,erbil,بغداد,العراق,البصره,اربيل',
  'Asia/Jerusalem': 'jerusalem,القدس', 'Asia/Gaza': 'gaza,palestine,غزه,فلسطين', 'Asia/Aden': 'sanaa,aden,yemen,صنعاء,عدن,اليمن',
  'Africa/Cairo': 'cairo,alexandria,giza,egypt,القاهره,الاسكندريه,الجيزه,مصر', 'Africa/Khartoum': 'khartoum,sudan,الخرطوم,السودان',
  'Africa/Tripoli': 'tripoli,libya,benghazi,طرابلس,ليبيا,بنغازي', 'Africa/Tunis': 'tunis,tunisia,تونس', 'Africa/Algiers': 'algiers,algeria,oran,الجزائر,وهران',
  'Africa/Casablanca': 'casablanca,rabat,marrakech,marrakesh,fez,tangier,morocco,الدار البيضاء,الرباط,مراكش,فاس,طنجه,المغرب',
  'Africa/Nouakchott': 'nouakchott,mauritania,نواكشوط,موريتانيا', 'Europe/Istanbul': 'istanbul,ankara,turkey,türkiye,اسطنبول,انقره,تركيا',
  'Asia/Tehran': 'tehran,iran,طهران,ايران', 'Asia/Karachi': 'karachi,islamabad,lahore,pakistan,كراتشي,اسلام اباد,باكستان',
  'Asia/Kolkata': 'mumbai,bombay,delhi,new delhi,bangalore,bengaluru,chennai,hyderabad,india,مومباي,دلهي,نيودلهي,الهند',
  'Asia/Dhaka': 'dhaka,bangladesh,دكا,بنغلاديش', 'Asia/Jakarta': 'jakarta,indonesia,جاكرتا,اندونيسيا', 'Asia/Kuala_Lumpur': 'kuala lumpur,malaysia,كوالالمبور,ماليزيا',
  'Asia/Singapore': 'singapore,سنغافوره', 'Asia/Manila': 'manila,philippines,مانيلا,الفلبين', 'Asia/Bangkok': 'bangkok,thailand,بانكوك,تايلاند',
  'Asia/Shanghai': 'beijing,shanghai,shenzhen,guangzhou,china,بكين,بيجين,شنغهاي,الصين', 'Asia/Hong_Kong': 'hong kong,هونغ كونغ',
  'Asia/Tokyo': 'tokyo,osaka,kyoto,japan,طوكيو,اوساكا,اليابان', 'Asia/Seoul': 'seoul,korea,south korea,سيول,كوريا',
  'Australia/Sydney': 'sydney,canberra,australia,سيدني,استراليا', 'Australia/Melbourne': 'melbourne,ملبورن', 'Pacific/Auckland': 'auckland,wellington,new zealand,اوكلاند,نيوزيلندا',
  'Europe/London': 'london,manchester,uk,united kingdom,england,britain,لندن,مانشستر,بريطانيا,المملكه المتحده,انجلترا',
  'Europe/Paris': 'paris,lyon,marseille,france,باريس,فرنسا', 'Europe/Berlin': 'berlin,munich,frankfurt,hamburg,germany,برلين,ميونخ,فرانكفورت,المانيا',
  'Europe/Madrid': 'madrid,barcelona,spain,مدريد,برشلونه,اسبانيا', 'Europe/Rome': 'rome,milan,italy,روما,ميلانو,ايطاليا',
  'Europe/Amsterdam': 'amsterdam,netherlands,holland,امستردام,هولندا', 'Europe/Moscow': 'moscow,russia,موسكو,روسيا', 'Europe/Athens': 'athens,greece,اثينا,اليونان',
  'Europe/Stockholm': 'stockholm,sweden,ستوكهولم,السويد', 'Europe/Zurich': 'zurich,geneva,switzerland,زيورخ,جنيف,سويسرا',
  'America/New_York': 'new york,nyc,washington,washington dc,boston,miami,atlanta,philadelphia,نيويورك,واشنطن,بوسطن,ميامي',
  'America/Chicago': 'chicago,houston,dallas,austin,شيكاغو,هيوستن,دالاس', 'America/Denver': 'denver,دنفر',
  'America/Los_Angeles': 'los angeles,la,san francisco,sf,seattle,las vegas,san diego,لوس انجلوس,لوس انجليس,سان فرانسيسكو,سياتل',
  'America/Toronto': 'toronto,ottawa,montreal,تورنتو,تورونتو,اوتاوا', 'America/Vancouver': 'vancouver,فانكوفر', 'America/Mexico_City': 'mexico city,mexico,مكسيكو,المكسيك',
  'America/Sao_Paulo': 'sao paulo,são paulo,rio,rio de janeiro,brazil,ساو باولو,البرازيل', 'America/Argentina/Buenos_Aires': 'buenos aires,argentina,بوينس ايرس,الارجنتين',
  'Africa/Lagos': 'lagos,nigeria,لاغوس,نيجيريا', 'Africa/Nairobi': 'nairobi,kenya,نيروبي,كينيا', 'Africa/Johannesburg': 'johannesburg,cape town,south africa,جوهانسبرغ,كيب تاون,جنوب افريقيا',
  'Africa/Addis_Ababa': 'addis ababa,ethiopia,اديس ابابا,اثيوبيا',
};
let cityIndex;
// "الرياض" = "رياض": the article is optional
const cityKey = (s) => foldCmd(s).replace(/^ال(?=\S{3})/, '');
function cities() {
  if (!cityIndex) {
    cityIndex = new Map();
    for (const [tz, names] of Object.entries(CITIES)) for (const n of names.split(',')) if (!cityIndex.has(cityKey(n))) cityIndex.set(cityKey(n), tz);
  }
  return cityIndex;
}
/**
 * The IANA time zone for a city or country name ("dubai", "دبي", "new york", "tokyo", "عمّان"), or null. `exact`: only
 * the list above or a zone whose city is exactly that name (no substring guesses).
 */
export function cityZone(name, { exact = false, zones = Intl.supportedValuesOf?.('timeZone') || [] } = {}) {
  const raw = String(name).trim().replace(/[?؟.!]+$/, '');
  // عمّان (with its shadda) is Amman; عمان without it is Oman
  if (/عمّان/.test(raw)) return 'Asia/Amman';
  const k = cityKey(raw);
  if (!k) return null;
  if (k === 'عمان') return 'Asia/Muscat';
  const hit = cities().get(k);
  if (hit) return hit;
  const needle = foldCmd(raw).replace(/\s+/g, '_');
  return zones.find((z) => z.toLowerCase().endsWith('/' + needle)) || (!exact && needle.length > 2 && zones.find((z) => z.toLowerCase().includes(needle))) || null;
}
const TIME_IN = /^(?:what(?:'s| is)?\s+(?:the\s+)?time\s+(?:is it\s+)?(?:now\s+)?in|what time is it in|time now in|current time in|local time in|time in|time at|clock in)\s+(.+)$/i;
const TIME_AFTER = /^(.+?)\s+(?:time|local time|time now)$/i;
const AR_TIME_IN = /^(?:(?:كم\s+)?الساعه(?:\s+كم)?(?:\s+الان)?|الوقت(?:\s+الان)?|التوقيت|توقيت|كم الوقت)\s+(?:في\s+|ب)(.+)$|^(?:توقيت|ساعه)\s+(.+)$/;
/**
 * "time in tokyo", "dubai time", "الوقت في دبي", "كم الساعة في لندن" → { city, exact } or null. "<city> time" only counts
 * for a known city (exact), so "screen time" and "pacific time" don't look like one.
 */
export function timeQuery(q) {
  const raw = String(q).trim().replace(/[?؟]+$/, '').trim();
  let m = raw.match(TIME_IN);
  if (m) return { city: m[1].trim(), exact: false };
  m = foldCmd(raw).match(AR_TIME_IN);
  if (m) {
    // give back the user's own spelling of the city (عمّان keeps its shadda) when the words line up
    const city = (m[1] || m[2]).trim();
    const words = raw.split(/\s+/), n = city.split(/\s+/).length;
    return { city: words.length > n ? words.slice(-n).join(' ').replace(/^ب(?=\S{3})/, '') : city, exact: false };
  }
  m = raw.match(TIME_AFTER);
  if (m && m[1].split(/\s+/).length <= 3) return { city: m[1].trim(), exact: true };
  return null;
}
