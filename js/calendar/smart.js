// Natural-language quick add: type an event in your own words — "Lunch with Sara Friday 1pm at Café Luna",
// "Soccer game Saturday 11am-1pm", "Vacation Mon-Fri", "gym every week on monday 7am",
// "اجتماع مع أحمد غدا الساعة 3 م في المكتب" — and Calendar recognises the date, time, repeat, place and people.
// Used by the quick-add field under the day's agenda, the editor's title suggestion and the Routines action
// "Create event". Ported from Liquid Tab's js/calendar/smart.js; builds on parseWhen() (js/shell/nlp.js). Pure, so
// .dev/calendar-model.mjs runs it in plain node.
import { parseWhen, foldArabic } from '../shell/nlp.js';
import { dkey, addDays, pad, parseKey, DAY } from './model.js';

const AP = '(am|pm|a\\.m\\.|p\\.m\\.|صباحا|صباحًا|صباح|مساء|مساءً|ظهرا|ظهرًا|ص|م)';
const NUM = '(\\d{1,2})(?:[:.](\\d{2}))?';
// "11am-1pm", "from 2 to 4pm", "2:30–3:15", "من 11 إلى 1 م"
const RANGE = new RegExp(`(^|\\s)((?:from|between|من)\\s+(?:الساع[ةه]\\s+)?)?${NUM}\\s*${AP}?\\s*(-|–|—|to|until|till|and|إلى|الى|حتى|لـ)\\s*(?:الساع[ةه]\\s+)?${NUM}\\s*${AP}?(?=[\\s.,!?؟،]|$)`, 'i');
const DAY_WORDS = [
  ['sun', 'sunday', 'الأحد', 'الاحد'], ['mon', 'monday', 'الاثنين', 'الإثنين'], ['tue', 'tues', 'tuesday', 'الثلاثاء'], ['wed', 'wednesday', 'الأربعاء', 'الاربعاء'],
  ['thu', 'thur', 'thurs', 'thursday', 'الخميس'], ['fri', 'friday', 'الجمعة', 'الجمعه'], ['sat', 'saturday', 'السبت'],
];
const dayAlt = DAY_WORDS.flat().sort((a, b) => b.length - a.length).join('|');
const DAY_RANGE = new RegExp(`(^|\\s)(?:(?:from|من)\\s+)?(?:يوم\\s+)?(${dayAlt})\\.?\\s*(?:-|–|—|to|through|thru|until|till|إلى|الى|حتى)\\s*(?:يوم\\s+)?(${dayAlt})\\.?(?=[\\s.,!?؟،]|$)`, 'i');
const END = '(?=[\\s.,!?؟،]|$)';
const REPEATS = [
  [new RegExp(`(^|\\s)(every\\s+other\\s+week|every\\s+2\\s+weeks|biweekly|fortnightly|كل\\s+[أا]سبوعين)${END}`, 'i'), { freq: 'week', interval: 2 }],
  [new RegExp(`(^|\\s)(every\\s+weekday|on\\s+weekdays|weekdays|أيام\\s+العمل|كل\\s+أيام\\s+العمل)${END}`, 'i'), { freq: 'week', interval: 1, days: [1, 2, 3, 4, 5] }],
  [new RegExp(`(^|\\s)(every\\s*day|daily|each\\s+day|كل\\s+يوم|يوميا|يوميًا)${END}`, 'i'), { freq: 'day', interval: 1 }],
  [new RegExp(`(^|\\s)(every\\s+week|weekly|each\\s+week|كل\\s+[أا]سبوع|[أا]سبوعيا|[أا]سبوعيًا)${END}`, 'i'), { freq: 'week', interval: 1 }],
  [new RegExp(`(^|\\s)(every\\s+month|monthly|each\\s+month|كل\\s+شهر|شهريا|شهريًا)${END}`, 'i'), { freq: 'month', interval: 1 }],
  [new RegExp(`(^|\\s)(every\\s+year|yearly|annually|each\\s+year|كل\\s+(?:سنة|عام)|سنويا|سنويًا)${END}`, 'i'), { freq: 'year', interval: 1 }],
];
// "every monday" / "كل اثنين": the weekday itself is left for parseWhen, "every" makes it repeat weekly
const EVERY_DAY = new RegExp(`(^|\\s)(every|each|كل)(?=\\s+(?:يوم\\s+)?(?:${dayAlt})(?:[\\s.,!?؟،]|$))`, 'i');
const DURATION = /(^|\s)(?:for\s+(\d+(?:\.\d+)?|an?|one|two|half\s+an)\s*(h|hrs?|hours?|m|mins?|minutes?)|لمدة\s+(?:(\d+)\s*)?(ساعة|ساعه|ساعتين|ساعات|دقيقة|دقيقه|دقائق|نصف\s+ساعة))(?=[\s.,!?؟،]|$)/i;
const PLACE_LAT = /(?:^|\s)(at|@|in)\s+((?:the\s+)?[\p{Lu}\p{N}][\p{L}\p{N}'’&.\-]*(?:\s+(?:(?:of|the|de|del|la|le|du|and|&)\s+)?[\p{Lu}\p{N}][\p{L}\p{N}'’&.\-]*)*)/gu;
const PLACE_AR = /(?:^|\s)(في|عند|بمقر|بمطعم|بمقهى)\s+([؀-ۿ][^\s]*(?:\s+[؀-ۿ\d][^\s]*){0,3})\s*$/u;
const PEOPLE_LAT = /(?:^|\s)(with|w\/)\s+([\p{Lu}][\p{L}'’\-]+(?:\s+[\p{Lu}][\p{L}'’\-]+)?(?:\s*(?:,|and|&)\s*[\p{Lu}][\p{L}'’\-]+(?:\s+[\p{Lu}][\p{L}'’\-]+)?)*)/u;
const PEOPLE_AR = /(?:^|\s)(مع)\s+([؀-ۿ]+(?:\s+و\s*[؀-ۿ]+)*)/u;
const LEFTOVER = /^(?:on|at|from|by|for|in|في|من|يوم|على)$/i;

function hour12(h, mi, ap) {
  ap = (ap || '').toLowerCase().replace(/[ًٌٍ]/g, '');
  if (/^(pm|p\.m\.|م|مساء|ظهرا)$/.test(ap) && h < 12) h += 12;
  if (/^(am|a\.m\.|ص|صباحا|صباح)$/.test(ap) && h === 12) h = 0;
  return h * 60 + mi;
}

/**
 * Parses a typed event. Returns
 * { title, date, time, endDate, endTime, allDay, repeat, place, people, spans, found }
 * where spans are { start, end, kind: 'when' | 'repeat' | 'place' | 'person' } in `text`, place = { text, start, end }
 * (the marker word included) or null and people = [{ name, start, end }].
 * `day` (a Date): the day to use when the text names a time but no day (quick add under a selected day).
 */
export function parseEvent(text, now = new Date(), { day: baseDay = null } = {}) {
  const s = String(text ?? '');
  let m = foldArabic(s).length === s.length ? foldArabic(s) : s; // ١٢ → 12 when it keeps positions
  const spans = [];
  const mask = (i, j, kind) => { if (j <= i) return; m = m.slice(0, i) + ' '.repeat(j - i) + m.slice(j); if (kind) spans.push({ start: i, end: j, kind }); };
  const hit = (re, kind) => { const x = m.match(re); if (!x) return null; const i = x.index + (x[1] || '').length; mask(i, x.index + x[0].length, kind); return x; };
  const out = { date: '', time: '', endDate: '', endTime: '', allDay: false, repeat: null, place: null, people: [], found: false };
  let start = null, end = null, durMin = 0;

  for (const [re, rep] of REPEATS) if (!out.repeat && hit(re, 'repeat')) out.repeat = { ...rep };
  if (!out.repeat && hit(EVERY_DAY, 'repeat')) out.repeat = { freq: 'week', interval: 1 };

  let x = hit(DURATION, 'when');
  if (x) {
    if (x[2] != null) { const n = /^(an?|one)$/i.test(x[2]) ? 1 : /^two$/i.test(x[2]) ? 2 : /half/i.test(x[2]) ? 0.5 : +x[2]; durMin = Math.round(/^h/i.test(x[3]) ? n * 60 : n); }
    else { const n = x[4] ? +x[4] : /ساعتين/.test(x[5]) ? 2 : 1; durMin = /نصف/.test(x[5]) ? 30 : /^س/.test(x[5]) ? n * 60 : n; }
  }

  // time range "11am-1pm"
  x = m.match(RANGE);
  const sep = (x?.[6] || '').toLowerCase();
  // a bare "2-4" or "2 and 4" isn't a time range without am/pm, minutes, "from" or "to"
  if (x && (sep === 'and' ? /between/i.test(x[2] || '') : sep === 'لـ' ? x[2] : (x[2] || x[5] || x[9] || x[4] || x[8] || /^(to|until|till|إلى|الى|حتى)$/.test(sep)))) {
    const h1 = +x[3], m1 = +(x[4] || 0), h2 = +x[7], m2 = +(x[8] || 0);
    if (h1 < 24 && h2 < 24 && m1 < 60 && m2 < 60) {
      let b = x[9] ? hour12(h2, m2, x[9]) : h2 * 60 + m2;
      let a = x[5] ? hour12(h1, m1, x[5]) : h1 * 60 + m1;
      if (!x[5] && x[9]) { const pm = hour12(h1, m1, x[9]); if (pm <= b && pm !== a) a = pm; }
      if (!x[5] && !x[9] && h1 >= 1 && h1 <= 7) { a += 720; if (b < a) b += 720; }
      if (b <= a) b += b + 720 > a && b < 720 ? 720 : 1440;
      start = a; end = b;
      mask(x.index + x[1].length, x.index + x[0].length, 'when');
    }
  }

  // day range "Mon-Fri"
  let dayFrom = null, dayTo = null;
  x = m.match(DAY_RANGE);
  if (x) {
    const a = DAY_WORDS.findIndex((w) => w.includes(x[2].toLowerCase())), b = DAY_WORDS.findIndex((w) => w.includes(x[3].toLowerCase()));
    if (a >= 0 && b >= 0) {
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      dayFrom = addDays(base, (a - base.getDay() + 7) % 7);
      dayTo = addDays(dayFrom, (b - a + 7) % 7);
      mask(x.index + x[1].length, x.index + x[0].length, 'when');
    }
  }

  // single dates and times: parseWhen, then find which words it took
  const w = parseWhen(m, now);
  if (w) {
    const keep = w.title.split(/\s+/).filter(Boolean);
    const toks = [...m.matchAll(/\S+/g)];
    let j = 0;
    for (const tk of toks) {
      const word = tk[0];
      if (j < keep.length && word === keep[j]) { j++; continue; }
      if (j < keep.length && word.endsWith(keep[j]) && word !== keep[j]) { mask(tk.index, tk.index + word.length - keep[j].length, 'when'); j++; continue; }
      if (j < keep.length && word.startsWith(keep[j])) { mask(tk.index + keep[j].length, tk.index + word.length, 'when'); j++; continue; }
      mask(tk.index, tk.index + word.length, 'when');
    }
  }

  // assemble the date and time
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const namedDay = !!(dayFrom || (w && hasDayWord(w, s)));
  let day = dayFrom || (w && namedDay ? parseKey(w.date) : null);
  if (start == null && w?.time) { const [hh, mi] = w.time.split(':').map(Number); start = hh * 60 + mi; }
  if (!day && start != null) {
    if (baseDay) day = new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate());
    else { day = new Date(today); if (start <= now.getHours() * 60 + now.getMinutes() && !out.repeat) day = addDays(day, 1); }
  }
  if (!day && w && !namedDay) day = parseKey(w.date);
  if (day) {
    out.found = true;
    out.date = dkey(day);
    if (start != null && !dayTo) {
      const e = end ?? start + (durMin || 60);
      out.time = `${pad(Math.floor(start / 60) % 24)}:${pad(start % 60)}`;
      out.endDate = dkey(addDays(day, Math.floor(e / 1440)));
      out.endTime = `${pad(Math.floor(e / 60) % 24)}:${pad(e % 60)}`;
    } else {
      out.allDay = true;
      out.endDate = dkey(dayTo || addDays(day, durMin >= 1440 ? Math.round(durMin / 1440) - 1 : 0));
    }
  } else if (out.repeat) {
    out.found = true;
    out.date = dkey(baseDay || today);
    out.allDay = true;
    out.endDate = out.date;
  }

  // people (kept in the title; offered as invitees)
  x = m.match(PEOPLE_LAT) || m.match(PEOPLE_AR);
  if (x) {
    let pos = x.index + x[0].indexOf(x[2], x[0].indexOf(x[1]) + x[1].length);
    for (const name of x[2].split(/\s*(?:,|\band\b|&)\s*|\s+و\s*/u).map((n) => n.trim()).filter(Boolean)) {
      const at = s.indexOf(name, pos);
      if (at < 0) continue;
      out.people.push({ name, start: at, end: at + name.length });
      spans.push({ start: at, end: at + name.length, kind: 'person' });
      pos = at + name.length;
    }
  }
  // place (at Café Luna / في المكتب): the last one wins
  let px = null;
  for (const y of m.matchAll(PLACE_LAT)) px = y;
  if (!px) { const y = m.replace(/\s+$/, '').match(PLACE_AR); if (y) px = y; }
  if (px) {
    const word = px.index + px[0].indexOf(px[1]);
    const ptext = px[2].trim();
    // a name right after "with" isn't a place ("with Sara in Paris" keeps Paris)
    if (!out.people.some((p) => p.start >= word && p.start < word + px[0].length)) {
      const at = px.index + px[0].lastIndexOf(ptext);
      out.place = { text: ptext.replace(/^the\s+/i, ''), start: word, end: at + ptext.length };
      spans.push({ start: at, end: at + ptext.length, kind: 'place' });
    }
  }
  out.spans = spans.sort((a, b) => a.start - b.start);
  out.title = titleFrom(s, out, false);
  return out;
}

// parseWhen() puts a time-only phrase on today or tomorrow; this tells whether the text itself named the day
const DAY_NAMED = /(today|tonight|tomorrow|tmrw|tmr|day after|اليوم|الليلة|غد|بكر|بعد\s+غد|\d{1,2}[/.]\d{1,2}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر|\bin\s+\d+\s*(?:days?|weeks?|d|w)\b|بعد\s+\S+\s*(?:يوم|أيام|ايام|أسبوع|اسبوع)|بعد\s+(?:يومين|أسبوعين|اسبوعين))/i;
function hasDayWord(w, s) {
  const f = foldArabic(s);
  return DAY_NAMED.test(f) || new RegExp(`(^|\\s)(?:${dayAlt})(?=[\\s.,!?؟،]|$)`, 'i').test(f);
}

/** The title that's left once the recognised words are taken out (and the place, once it's added as the location). */
export function titleFrom(s, p, withoutPlace) {
  const m = s.split('');
  for (const sp of p.spans) if (sp.kind === 'when' || sp.kind === 'repeat') for (let i = sp.start; i < sp.end; i++) m[i] = ' ';
  if (withoutPlace && p.place) for (let i = p.place.start; i < p.place.end; i++) m[i] = ' ';
  const words = m.join('').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  while (words.length && LEFTOVER.test(words.at(-1))) words.pop();
  while (words.length && LEFTOVER.test(words[0])) words.shift();
  return words.join(' ').replace(/\s+([,.!?؟،])/g, '$1').replace(/^[,،]\s*|[,،]\s*$/g, '').trim();
}

/**
 * An event ({ title, start, end, allDay, repeat, place, people }) from typed text: the recognised date, time and
 * repeat are taken out of the title, the place becomes the location, the people become invitees (and stay in the
 * title: "Lunch with Sara"). Without a date or time it is an all-day event on `day` (default today).
 */
export function eventFromText(text, now = new Date(), { day = null } = {}) {
  const p = parseEvent(text, now, { day });
  const base = day || now;
  let start, end;
  const allDay = !p.found || p.allDay;
  if (!p.found) {
    start = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
    end = start + DAY - 60e3;
  } else if (allDay) {
    start = parseKey(p.date).getTime();
    end = parseKey(p.endDate || p.date).getTime() + DAY - 60e3;
  } else {
    const [h1, m1] = p.time.split(':').map(Number), [h2, m2] = p.endTime.split(':').map(Number);
    const d0 = parseKey(p.date), d1 = parseKey(p.endDate || p.date);
    start = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), h1, m1).getTime();
    end = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), h2, m2).getTime();
  }
  const title = titleFrom(String(text ?? ''), p, true) || p.title || String(text ?? '').trim();
  const repeat = p.repeat ? { ...p.repeat } : null;
  return { title, start, end, allDay, repeat, place: p.place?.text || '', people: p.people.map((x) => x.name), found: p.found || !!p.place };
}
