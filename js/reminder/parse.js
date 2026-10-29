// Natural-language reminders in English and Arabic (ported from Liquid Tab's reminders/parse.js + nlp.js and the
// first Bloom Tab parser): "Call mom tomorrow 6pm", "in 2 days at 5pm", "Pay rent every month", "Gym every Monday and
// Thursday at 7", "Dentist Oct 30 10am", "#Work !", "ذكرني بالاتصال بأمي غدا الساعة 5 مساء", "كل يوم الجمعة",
// "بعد يومين الساعة ٨ صباحا". It also reports which parts of the text it recognised (`spans`), so the quick-add field
// can highlight them while you type. Pure: no DOM, no storage (plain-node tests, the service worker).
import { nextAfter } from './model.js';

const EN_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const EN_DAYS_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const AR_DAYS = [['الأحد', 'الاحد'], ['الاثنين', 'الإثنين'], ['الثلاثاء'], ['الأربعاء', 'الاربعاء'], ['الخميس'], ['الجمعة', 'الجمعه'], ['السبت']];
// the same days without "ال", for "كل جمعة" / "كل يوم الجمعة"
const AR_DAY_STEMS = [['أحد', 'احد'], ['اثنين', 'إثنين'], ['ثلاثاء'], ['أربعاء', 'اربعاء'], ['خميس'], ['جمعة', 'جمعه'], ['سبت']];
const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const EN_MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sept?', 'oct', 'nov', 'dec'];
// Egypt/Gulf names, then the Levant/Iraq names
const AR_MONTHS = [['يناير', 'كانون الثاني'], ['فبراير', 'شباط'], ['مارس', 'آذار', 'اذار'], ['أبريل', 'ابريل', 'إبريل', 'نيسان'], ['مايو', 'أيار', 'ايار'], ['يونيو', 'حزيران'],
  ['يوليو', 'تموز'], ['أغسطس', 'اغسطس', 'آب'], ['سبتمبر', 'أيلول', 'ايلول'], ['أكتوبر', 'اكتوبر', 'تشرين الأول', 'تشرين الاول'], ['نوفمبر', 'تشرين الثاني'], ['ديسمبر', 'كانون الأول', 'كانون الاول']];
const S = '(?:^|\\s)'; // Arabic-safe start boundary (\b only knows ASCII letters)
const E = '(?=\\s|$|[.,!?،؟])'; // Arabic-safe end boundary
const TAN = '(?:اً|ًا|ا)'; // "يوميًا" is typed with or without the tanween
const alt = (a) => a.flat().slice().sort((x, y) => y.length - x.length).join('|');
const enDay = (w) => {
  const x = w.toLowerCase();
  const i = EN_DAYS.indexOf(x);
  return i >= 0 ? i : EN_DAYS_SHORT.indexOf(x.slice(0, 3));
};
const arDay = (w) => AR_DAY_STEMS.findIndex((v) => v.includes(w.replace(/^ال/, ''))) ;
const EN_DAY_RE = EN_DAYS.join('|') + '|' + EN_DAYS_SHORT.join('|') + '|tues|thur|thurs';
const AR_DAY_RE = '(?:ال)?(?:' + alt(AR_DAY_STEMS) + ')';
const EN_MONTH_RE = EN_MONTHS.join('|') + '|' + EN_MONTHS_SHORT.join('|');
const enMonth = (w) => {
  const x = w.toLowerCase().replace(/\.$/, '');
  const i = EN_MONTHS.indexOf(x);
  return i >= 0 ? i : ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(x.slice(0, 3));
};
const arMonth = (w) => AR_MONTHS.findIndex((v) => v.includes(w.replace(/\s+/g, ' ')));
const UNIT = (u) => (/^(d|day|days|يوم|أيام|ايام|يومين)$/i.test(u) ? 'd' : /^(w|week|weeks|أسبوع|اسبوع|أسابيع|اسابيع|أسبوعين|اسبوعين)$/i.test(u) ? 'w'
  : /^(month|months|شهر|أشهر|اشهر|شهور|شهرين)$/i.test(u) ? 'm' : /^(year|years|سنة|سنوات|عام|أعوام|اعوام|سنتين|عامين)$/i.test(u) ? 'y' : null);

/** The repeat presets offered in the editor (and recognised in text). */
export const PRESETS = {
  daily: { f: 'd' }, weekdays: { f: 'w', days: [1, 2, 3, 4, 5] }, weekends: { f: 'w', days: [0, 6] }, weekly: { f: 'w' },
  biweekly: { f: 'w', n: 2 }, monthly: { f: 'm' }, yearly: { f: 'y' },
};
// fixed repeat phrases, most specific first ("every weekday" before "every day", "كل يوم عمل" before "كل يوم")
const REPEATS = [
  ['biweekly', /\b(every other week|every (?:2|two) weeks|bi-?weekly|fortnightly)\b/i],
  ['biweekly', new RegExp(S + 'كل\\s+(?:أسبوعين|اسبوعين)' + E)],
  ['weekdays', /\b(every weekday|on weekdays|weekdays)\b/i],
  ['weekdays', new RegExp(S + '(?:كل\\s+يوم\\s+عمل|(?:في\\s+)?(?:أيام|ايام)\\s+العمل)' + E)],
  ['weekends', /\b(every weekend|on weekends|weekends)\b/i],
  ['weekends', new RegExp(S + '(?:كل\\s+(?:عطلة\\s+)?نهاية\\s+(?:أسبوع|اسبوع)|(?:في\\s+)?عطلات?\\s+نهاية\\s+(?:الأسبوع|الاسبوع))' + E)],
  ['daily', /\b(every ?day|each day|daily)\b/i],
  ['daily', new RegExp(S + '(?:كل\\s+يوم|يومي' + TAN + ')' + E)],
  ['weekly', /\b(every week|each week|weekly)\b/i],
  ['weekly', new RegExp(S + '(?:كل\\s+(?:أسبوع|اسبوع)|(?:أ|ا)سبوعي' + TAN + ')' + E)],
  ['monthly', /\b(every month|each month|monthly)\b/i],
  ['monthly', new RegExp(S + '(?:كل\\s+شهر|شهري' + TAN + ')' + E)],
  ['yearly', /\b(every year|each year|yearly|annually)\b/i],
  ['yearly', new RegExp(S + '(?:كل\\s+(?:سنة|سنه|عام)|سنوي' + TAN + ')' + E)],
];

/**
 * parseQuickTime("Call mom tomorrow 6pm") → { title: 'Call mom', due: <ms>, repeat: null, important: false, cat: null,
 *   spans: [[start, end, kind]] } — kind 'lead' (remind me to), 'date', 'time', 'repeat', 'imp', 'cat'.
 * `due` is a ms timestamp or null; never in the past. opts.cats ([{ id, name }]) lets "#Work" pick a category.
 */
export function parseQuickTime(text, now = new Date(), { cats = [] } = {}) {
  if (!(now instanceof Date)) now = new Date(now);
  const src = String(text || '');
  // Same-length replacements only (digits, cut-outs → spaces): positions in `s` stay those of the text + 1.
  let s = ' ' + src.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) + ' ';
  const spans = [];
  const cutAt = (i, len, kind) => {
    let a = i, b = i + len;
    while (a < b && /\s/.test(s[a])) a++;
    while (b > a && /\s/.test(s[b - 1])) b--;
    if (b > a) spans.push([a - 1, b - 1, kind]);
    s = s.slice(0, i) + ' '.repeat(len) + s.slice(i + len);
  };
  const cut = (re, kind = 'date') => {
    const m = re.exec(s);
    if (m) cutAt(m.index, m[0].length, kind);
    return m;
  };

  cut(/^\s*(remind me (to|about|that)|reminder:)\s*/i, 'lead');
  cut(/^\s*ذكرني\s*(بأن|بان|أن|ان|ب)?\s*/, 'lead');

  // "!" (or !! / !!!) marks the reminder Important; "#Name" files it in that category
  const important = !!cut(/(?:^|\s)(!{1,3})(?=\s|$)/, 'imp');
  let cat = null;
  for (const m of s.matchAll(/(?:^|\s)#([^\s#.,;:!?؟،()]+)/gu)) {
    const want = m[1].replace(/_/g, ' ').toLocaleLowerCase();
    const c = cats.find((x) => String(x.name || '').trim().toLocaleLowerCase() === want);
    if (c && !cat) {
      cat = c.id;
      const at = m.index + m[0].indexOf('#');
      cutAt(at, m[1].length + 1, 'cat');
    }
  }

  // ——— repeats ———
  let repeat = null;
  // "every 3 days" / "كل 3 أيام" / "كل يومين"
  let m = cut(/\bevery\s+(\d+)\s+(days?|weeks?|months?|years?)\b/i, 'repeat')
    || cut(new RegExp(S + 'كل\\s+(\\d+)\\s+(يوم|أيام|ايام|أسبوع|اسبوع|أسابيع|اسابيع|شهر|أشهر|اشهر|شهور|سنة|سنوات|عام|أعوام|اعوام)' + E), 'repeat');
  if (m) {
    const f = UNIT(m[2].toLowerCase());
    if (f) repeat = +m[1] > 1 ? { f, n: +m[1] } : { f };
  }
  if (!repeat && (m = cut(new RegExp(S + 'كل\\s+(يومين|شهرين|سنتين|عامين)' + E), 'repeat'))) repeat = { f: UNIT(m[1]), n: 2 };
  // "every Monday and Thursday" / "on Mondays" / "كل يوم الجمعة" / "كل اثنين وخميس"
  if (!repeat) {
    const dayList = '(' + EN_DAY_RE + ')s?((?:\\s*(?:,|and|&)\\s*(?:' + EN_DAY_RE + ')s?)*)';
    m = cut(new RegExp('\\b(?:every|each)\\s+' + dayList + '\\b', 'i'), 'repeat') || cut(new RegExp('\\bon\\s+(' + EN_DAY_RE + ')s((?:\\s*(?:,|and|&)\\s*(?:' + EN_DAY_RE + ')s)*)\\b', 'i'), 'repeat');
    if (m) {
      const days = [m[1], ...(m[2] || '').split(/\s*(?:,|and|&)\s*/i)].filter(Boolean).map((w) => enDay(w.replace(/s$/i, ''))).filter((d) => d >= 0);
      if (days.length) repeat = { f: 'w', days: [...new Set(days)].sort() };
    }
    if (!repeat) {
      const one = '(?:يوم\\s+)?(' + AR_DAY_RE + ')';
      m = cut(new RegExp(S + 'كل\\s+' + one + '((?:\\s*(?:،|,)?\\s*و\\s*(?:يوم\\s+)?' + AR_DAY_RE + ')*)' + E), 'repeat');
      if (m) {
        const days = [m[1], ...(m[2] || '').split(/\s*(?:،|,)?\s*و\s*(?:يوم\s+)?/)].map((w) => w.trim()).filter(Boolean).map(arDay).filter((d) => d >= 0);
        if (days.length) repeat = { f: 'w', days: [...new Set(days)].sort() };
      }
    }
  }
  if (!repeat) {
    for (const [k, re] of REPEATS) {
      if (cut(re, 'repeat')) {
        repeat = { ...PRESETS[k], ...(PRESETS[k].days ? { days: [...PRESETS[k].days] } : {}) };
        break;
      }
    }
  }

  // ——— relative times ———
  let rel = null; // ms offset (minutes, hours)
  let relDays = null; // whole days ahead ("in 2 days at 5pm" keeps its time)
  let day = null; // Date (midnight)
  let hour = null, minute = 0, meridiem = null, defaultHour = 9;
  const setRel = (n, u) => {
    if ((u === 'd' || u === 'w') && Number.isInteger(n * (u === 'w' ? 7 : 1))) relDays = n * (u === 'w' ? 7 : 1);
    else rel = n * (u === 'm' ? 60e3 : u === 'h' ? 3600e3 : u === 'd' ? 86400e3 : 7 * 86400e3);
  };
  m = cut(/\bin\s+(an?|half an?|\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/i);
  if (m) setRel(/^half/i.test(m[1]) ? 0.5 : /^an?$/i.test(m[1]) ? 1 : parseFloat(m[1]), m[2].toLowerCase()[0]);
  if (rel == null && relDays == null) {
    m = cut(new RegExp(S + 'بعد\\s+(نص|نصف|ربع)\\s+ساع[ةه]' + E));
    if (m) rel = (m[1] === 'ربع' ? 15 : 30) * 60e3;
  }
  if (rel == null && relDays == null) {
    m = cut(new RegExp(S + 'بعد\\s+(\\d+\\s*)?(دقيقتين|دقيقة|دقيقه|دقائق|ساعتين|ساعة|ساعه|ساعات|يومين|يوم|أيام|ايام|أسبوعين|اسبوعين|أسبوع|اسبوع|أسابيع|اسابيع)' + E));
    if (m) {
      const w = m[2];
      const n = m[1] ? parseFloat(m[1]) : /ين$/.test(w) ? 2 : 1;
      setRel(n, /دقي|دقا/.test(w) ? 'm' : /ساع/.test(w) ? 'h' : /يوم|أيام|ايام/.test(w) ? 'd' : 'w');
    }
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
  const addMonths = (n) => new Date(today.getFullYear(), today.getMonth() + n, Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth() + n + 1, 0).getDate()));
  let dayFixed = false; // an explicit calendar date: keep it even when its time has passed
  // "in 2 months" / "in a year" / "بعد شهرين" / "بعد سنة": that date, at 9:00 or the time given
  let relMonths = null;
  if (rel == null && relDays == null) {
    m = cut(/\bin\s+(an?|\d+)\s+(months?|years?)\b/i);
    if (m) relMonths = (/^an?$/i.test(m[1]) ? 1 : +m[1]) * (/^y/i.test(m[2]) ? 12 : 1);
    else if ((m = cut(new RegExp(S + 'بعد\\s+(\\d+\\s*)?(شهرين|شهر|أشهر|اشهر|شهور|سنتين|عامين|سنة|سنه|سنوات|عام)' + E)))) {
      const n = m[1] ? parseFloat(m[1]) : /ين$/.test(m[2]) ? 2 : 1;
      relMonths = n * (/شه/.test(m[2]) ? 1 : 12);
    }
  }

  if (rel == null) {
    if (relDays != null) day = addDays(relDays);
    else if (relMonths != null) day = addMonths(relMonths);
    else if (cut(/\b(the )?day after tomorrow\b/i) || cut(new RegExp(S + 'بعد\\s+(غد|غدا|غدًا|غداً|بكرة|بكره)' + E))) day = addDays(2);
    else if (cut(/\btomorrow\b|\btmrw\b/i) || cut(new RegExp(S + '(غدا|غدًا|غداً|بكرة|بكره|الغد)' + E))) day = addDays(1);
    else if (cut(/\btonight\b/i) || cut(new RegExp(S + '(الليلة|الليله)' + E))) {
      day = today;
      defaultHour = 20;
    } else if (cut(/\btoday\b/i) || cut(new RegExp(S + 'اليوم' + E))) day = today;
    else if (cut(/\bnext week\b/i) || cut(new RegExp(S + '(الأسبوع|الاسبوع)\\s+(القادم|الجاي|المقبل)' + E))) day = addDays(7);
    else if (cut(/\bnext month\b/i) || cut(new RegExp(S + '(الشهر)\\s+(القادم|الجاي|المقبل)' + E))) {
      day = new Date(today.getFullYear(), today.getMonth() + 1, Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth() + 2, 0).getDate()));
    } else {
      // calendar dates: "Oct 30", "30 October 2027", "on the 3rd of may", "30 أكتوبر", "2026-11-03"
      let y = null, mo = -1, d = 0;
      if ((m = cut(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
      else if ((m = cut(new RegExp('\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + EN_MONTH_RE + ')\\.?(?:,?\\s+(\\d{4}))?\\b', 'i')))) [d, mo, y] = [+m[1], enMonth(m[2]), m[3] ? +m[3] : null];
      else if ((m = cut(new RegExp('\\b(?:on\\s+)?(' + EN_MONTH_RE + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'i')))) [mo, d, y] = [enMonth(m[1]), +m[2], m[3] ? +m[3] : null];
      else if ((m = cut(new RegExp(S + '(?:يوم\\s+)?(\\d{1,2})\\s+(?:من\\s+)?(' + alt(AR_MONTHS) + ')(?:\\s+(\\d{4}))?' + E)))) [d, mo, y] = [+m[1], arMonth(m[2]), m[3] ? +m[3] : null];
      if (mo >= 0 && d >= 1 && d <= 31) {
        let x = new Date(y ?? today.getFullYear(), mo, d);
        if (x.getMonth() !== mo) x = new Date(y ?? today.getFullYear(), mo + 1, 0); // Feb 30 → Feb 28/29
        if (y == null && x < today) x = new Date(x.getFullYear() + 1, mo, d);
        day = x;
        dayFixed = true;
      } else if (!repeat?.days?.length) {
        // weekdays: "on friday", "next fri", "يوم الجمعة" (not when a repeat already named its days: "صلاة الجمعة كل جمعة")
        m = cut(new RegExp('\\b(?:on\\s+|next\\s+|this\\s+)?(' + EN_DAY_RE + ')\\b', 'i'));
        let wd = m ? enDay(m[1]) : -1;
        if (wd < 0) {
          for (let i = 0; i < 7 && wd < 0; i++) {
            if (cut(new RegExp(S + '(يوم\\s+)?(' + AR_DAYS[i].join('|') + ')' + E))) wd = i;
          }
        }
        if (wd >= 0) {
          let diff = (wd - today.getDay() + 7) % 7;
          if (diff === 0) diff = 7;
          day = addDays(diff);
        }
      }
    }

    // explicit times
    m = cut(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\s|$|[.,!?])/i, 'time');
    if (m) {
      hour = +m[1];
      minute = +(m[2] || 0);
      meridiem = m[3][0].toLowerCase();
    }
    const AR_MER = '(صباحا|صباحًا|صباحاً|الصبح|ص|مساء|مساءً|مساءا|المساء|م|ظهرا|ظهرًا|الظهر|عصرا|عصرًا|العصر|ليلا|ليلًا|بالليل)';
    const arMer = (w) => (/^(صباح|الصبح|ص$)/.test(w) ? 'a' : 'p');
    if (hour == null) {
      m = cut(new RegExp(S + '(?:الساعة|الساعه|ساعة|عند)\\s*(\\d{1,2})(?::(\\d{2}))?(?:\\s*' + AR_MER + ')?' + E), 'time');
      if (m) {
        hour = +m[1];
        minute = +(m[2] || 0);
        if (m[3]) meridiem = arMer(m[3]);
      }
    }
    if (hour == null) {
      // "5 مساء" without الساعة: the period word is required, so "5 تفاحات" stays text
      m = cut(new RegExp(S + '(\\d{1,2})(?::(\\d{2}))?\\s*' + AR_MER + E), 'time');
      if (m) {
        hour = +m[1];
        minute = +(m[2] || 0);
        meridiem = arMer(m[3]);
      }
    }
    if (hour == null) {
      m = cut(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i, 'time') || cut(/(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$)/, 'time');
      if (m) {
        hour = +m[1];
        minute = +(m[2] || 0);
      }
    }
    if (hour == null) {
      const words = [
        [/\b(?:at )?noon\b|(?:^|\s)(الظهر|ظهرا|ظهرًا)(?=\s|$)/i, 12],
        [/\b(?:at )?midnight\b|(?:^|\s)منتصف الليل(?=\s|$)/i, 0],
        [/\b(in the )?morning\b|(?:^|\s)(صباحا|صباحًا|صباحاً|الصبح)(?=\s|$)/i, 9],
        [/\b(in the )?afternoon\b|(?:^|\s)(العصر|عصرا|عصرًا)(?=\s|$)/i, 15],
        [/\b(in the )?evening\b|(?:^|\s)(مساء|مساءً|المساء)(?=\s|$)/i, 18],
        [/\bat night\b|(?:^|\s)(بالليل|ليلا|ليلًا)(?=\s|$)/i, 21],
      ];
      for (const [re, hr] of words) {
        if (cut(re, 'time')) {
          hour = hr;
          minute = 0;
          meridiem = 'x';
          break;
        }
      }
    }
  }

  let due = null;
  if (rel != null) due = now.getTime() + rel;
  else if (relDays != null && hour == null) due = now.getTime() + relDays * 86400e3; // "in 3 days": same time of day
  else if (day || hour != null || repeat) {
    if (hour != null && hour <= 23 && minute <= 59) {
      if (meridiem === 'p' && hour < 12) hour += 12;
      if (meridiem === 'a' && hour === 12) hour = 0;
    } else hour = null;
    const ambiguous = hour != null && !meridiem && hour >= 1 && hour <= 11;
    const base = day || today;
    if (repeat && !day) {
      // the first occurrence: today when its time is still ahead (or one of its weekdays), else the next one
      const hh = hour ?? defaultHour, mm = hour == null ? 0 : minute;
      let first = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hh + (ambiguous && hh <= 6 ? 12 : 0), mm).getTime();
      if (repeat.days?.length) {
        for (let i = 0; i < 8; i++) {
          const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i, hh + (ambiguous && hh <= 6 ? 12 : 0), mm);
          if (repeat.days.includes(x.getDay()) && x.getTime() > now.getTime()) {
            first = x.getTime();
            break;
          }
        }
      } else if (first <= now.getTime()) first = nextAfter({ due: first, repeat }, now.getTime()) ?? first;
      due = first;
    } else if (hour == null) {
      due = new Date(base.getFullYear(), base.getMonth(), base.getDate(), defaultHour, 0).getTime();
      if (due <= now.getTime()) due = Math.ceil((now.getTime() + 30 * 60e3) / 3600e3) * 3600e3;
    } else {
      due = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute).getTime();
      if (ambiguous && hour <= 6) due += 12 * 3600e3; // "at 5" → 5 pm
      if ((!day || (dayFixed && base.getTime() === today.getTime())) && due <= now.getTime()) {
        if (ambiguous && hour > 6 && due + 12 * 3600e3 > now.getTime()) due += 12 * 3600e3;
        else if (!dayFixed) due += 86400e3;
      }
    }
  }

  const title = s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\s+|^)(at|on|by|في|يوم|على)$/i, '')
    .trim();
  spans.sort((a, b) => a[0] - b[0]);
  return { title: title ? title.charAt(0).toUpperCase() + title.slice(1) : '', due, repeat, important, cat, spans };
}
