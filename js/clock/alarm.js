// Clock › Alarm, the One UI way: the big "Alarm in 7 hours 15 minutes" title over the list of alarm cards (label,
// time, the week's days or the day it rings once, a switch; "Snoozed until …" with Dismiss), selection mode (⋮ › Edit
// or a long press: All, Turn on / Turn off / Delete), and the editor: AM/PM, hour and minute wheels, the day chips or a
// date from the calendar ("Ring once"), Alarm name, Alarm sound (tones, volume, gradually louder) and Snooze
// (interval and how many times), with Cancel / Save. On a desktop window it opens as One UI's tablet pop-up.
import { h, sameDay, everyMinute, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtHM, fmtPeriod, fmtTime, fmtDate, use12h, weekdayNames, locale } from '../core/i18n.js';
import { store } from '../core/store.js';
import { dialog, iconBtn, menu, sw, toast } from '../core/ui.js';
import { nextAlarmTime } from '../core/schedule.js';
import * as C from './core.js';
import * as D from './data.js';
import { wheel } from './wheel.js';
import { fmtSpan, pl } from './zones.js';
import { toneName, radioList, soundPicker, selBar } from './kit.js';
import { stopSound } from './sound.js';

const pad = (n) => String(n).padStart(2, '0');
const timeDate = (time) => {
  const [hh, mm] = String(time).split(':').map(Number);
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d;
};
const keyDate = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** "Every day", "Weekdays", "Weekends", "Every Mon, Wed" */
export function repeatText(days) {
  const key = [...days].sort().join('');
  if (key === '0123456') return t('clock.everyDay');
  if (key === '12345') return t('clock.weekdays');
  if (key === '06') return t('clock.weekends');
  const names = weekdayNames('short');
  return t('clock.everyDays', { d: [...days].sort().map((i) => names[i]).join(t('clock.listSep')) });
}
/** When a one-time alarm rings: "Today" / "Tomorrow" / "Tue, Nov 3". */
function onceText(a, now = Date.now()) {
  const at = nextAlarmTime(a, now);
  if (!at) return a.date ? fmtDate(keyDate(a.date), { weekday: 'short', month: 'short', day: 'numeric' }) : t('common.tomorrow');
  if (sameDay(at, now)) return t('common.today');
  if (sameDay(at, now + 864e5)) return t('common.tomorrow');
  return fmtDate(new Date(at), { weekday: 'short', month: 'short', day: 'numeric' });
}
const snoozeText = (n) => (n.snoozeRepeat ? t('clock.snoozeSub', { m: pl('clock.u.min', n.snoozeMin), r: pl('clock.times', n.snoozeRepeat) }) : t('clock.snoozeSubForever', { m: pl('clock.u.min', n.snoozeMin) }));

export function alarmView(ctx, tabs, { settings }) {
  let sel = null; // ids picked in selection mode
  const page = ctx.page({ title: t('clock.tab.alarm'), className: 'clk-page clk-alarm-page' });
  const heroTitle = page.el.querySelector('.app-hero-title');
  page.el.appendChild(tabs);
  page.body.classList.add('clk-body');
  const listEl = h('div', { class: 'clk-alarms' });
  page.body.append(listEl);
  let bar = null;

  const select = (id) => {
    sel = new Set(id ? [id] : []);
    draw();
  };
  const leave = () => {
    sel = null;
    draw();
  };
  const toggle = (id) => {
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    draw();
  };
  // Esc leaves selection mode first (the window's own handler would close the app), unless a popup is open on top
  const onEsc = (e) => {
    if (e.key !== 'Escape' || !sel || !ctx.focused || e.defaultPrevented || document.querySelector('.ou-menu-scrim:not(.closing), .ou-dialog-scrim, .clk-ringing')) return;
    e.preventDefault();
    leave();
  };
  addEventListener('keydown', onEsc, true);

  function actions() {
    if (sel) {
      const all = D.alarms();
      const every = all.length && all.every((a) => sel.has(a.id));
      return [
        h('button', { class: ['clk-allbtn', every && 'on'], 'aria-pressed': String(!!every), onClick: () => { sel = every ? new Set() : new Set(all.map((a) => a.id)); draw(); } },
          h('span', { class: 'clk-check', html: icon('check', 14) }), t('clock.all')),
        iconBtn('close', leave, t('common.cancel')),
      ];
    }
    return [
      iconBtn('plus', () => editAlarm(), t('clock.addAlarm')),
      iconBtn('more', (e) => menu(e.currentTarget, [
        { label: t('common.edit'), icon: 'edit', disabled: !D.alarms().length, onClick: () => select() },
        { label: t('common.settings'), icon: 'settings', onClick: settings },
      ], { align: 'end' }), t('common.more')),
    ];
  }

  function card(a) {
    const n = C.normAlarm(a);
    const d = timeDate(n.time), per = fmtPeriod(d);
    const isSn = C.snoozed(a);
    const checked = sel?.has(a.id);
    const names = weekdayNames('narrow');
    const el = h('div', {
      class: ['clk-alarm', !a.enabled && !isSn && 'off', sel && 'selecting', checked && 'checked'], role: sel ? 'checkbox' : 'button', tabindex: 0,
      'aria-checked': sel ? String(!!checked) : null, dataset: { id: a.id },
      onClick: () => (sel ? toggle(a.id) : editAlarm(a)),
      onKeydown: (e) => { if (e.key === 'Enter' || (sel && e.key === ' ')) { e.preventDefault(); sel ? toggle(a.id) : editAlarm(a); } },
    },
      sel ? h('span', { class: 'clk-check', html: icon('check', 14) }) : null,
      h('div', { class: 'clk-alarm-main' },
        a.label ? h('div', { class: 'clk-alarm-label' }, a.label) : null,
        h('div', { class: 'clk-alarm-time' }, h('span', { dir: 'ltr' }, fmtHM(d)), per ? h('small', null, per) : null),
        isSn ? h('div', { class: 'clk-alarm-snz' }, h('span', { html: icon('clkSnooze', 15) }), h('span', null, t('clock.snoozedUntil', { t: fmtTime(new Date(a.snoozeAt)) })),
          sel ? null : h('button', { class: 'clk-snz-x', onClick: (e) => { e.stopPropagation(); D.cancelSnooze(a.id); } }, t('clock.dismiss'))) : null),
      h('div', { class: 'clk-alarm-days' }, n.days.length
        ? names.map((x, i) => h('span', { class: [n.days.includes(i) && 'on', i === 0 && 'sun'] }, x))
        : h('span', { class: 'on once' }, onceText(n))),
      sel ? null : sw(a.enabled, (v) => {
        D.setEnabled([a.id], v);
        const at = v && nextAlarmTime(D.alarms().find((x) => x.id === a.id) || a);
        if (at) toast(t('clock.alarmSetFor', { d: fmtSpan(at - Date.now()) }));
      }, { label: fmtTime(d) }));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (sel) return;
      menu(e, [
        { label: t('common.edit'), icon: 'edit', onClick: () => editAlarm(a) },
        { label: t('clock.select'), icon: 'checkCircle', onClick: () => select(a.id) },
        { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => { D.deleteAlarms([a.id]); toast(t('clock.deleted1')); } },
      ]);
    });
    onLongPress(el, () => !sel && select(a.id));
    return el;
  }

  function draw() {
    const all = D.alarms(), now = Date.now();
    if (sel) for (const id of [...sel]) if (!all.some((a) => a.id === id)) sel.delete(id);
    if (sel && !all.length) sel = null;
    const next = C.nextOf(all, now);
    page.setTitle(sel ? (sel.size ? t('clock.nSelected', { n: sel.size }) : t('clock.selectAlarms')) : t('clock.tab.alarm'));
    heroTitle.textContent = sel ? (sel.size ? t('clock.nSelected', { n: sel.size }) : t('clock.selectAlarms')) : next ? t('clock.alarmIn', { d: fmtSpan(next.at - now) }) : t('clock.allOff');
    page.setSubtitle(!sel && next ? `${fmtDate(new Date(next.at), { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(new Date(next.at))}` : '');
    page.setActions(actions());
    page.el.classList.toggle('clk-selecting', !!sel);
    bar?.remove();
    bar = null;
    if (sel) {
      const picked = all.filter((a) => sel.has(a.id));
      bar = selBar([
        { icon: 'alarm', label: t('clock.turnOn'), disabled: !picked.length, onClick: () => { D.setEnabled([...sel], true); leave(); } },
        { icon: 'bellOff', label: t('clock.turnOff'), disabled: !picked.length, onClick: () => { D.setEnabled([...sel], false); leave(); } },
        { icon: 'trash', label: t('common.delete'), danger: true, disabled: !picked.length, onClick: () => { const n = sel.size; D.deleteAlarms([...sel]); leave(); toast(n === 1 ? t('clock.deleted1') : t('clock.deletedN', { n })); } },
      ]);
      page.el.appendChild(bar);
    }
    if (!all.length) {
      listEl.replaceChildren(h('div', { class: 'ou-empty clk-empty' }, h('span', { html: icon('alarm', 56) }), t('clock.noAlarms'),
        h('button', { class: 'ou-btn primary', onClick: () => editAlarm() }, t('clock.addAlarm'))));
      return;
    }
    listEl.replaceChildren(...[...all].sort((a, b) => a.time.localeCompare(b.time) || String(a.label).localeCompare(String(b.label))).map(card));
  }
  draw();
  const offs = [store.on('alarms', draw), everyMinute(draw)];
  return () => {
    offs.forEach((f) => f());
    bar?.remove();
    removeEventListener('keydown', onEsc, true);
  };
}

// ——— the editor ———
export async function editAlarm(existing) {
  const a = C.normAlarm(existing ? structuredClone(existing) : C.newAlarm());
  a.days = [...a.days];
  let [hour, minute] = C.hm(a);
  const h12 = use12h();
  const curTime = () => `${pad(hour)}:${pad(minute)}`;
  const draft = () => ({ ...a, time: curTime(), enabled: true, snoozeAt: 0 });

  // wheels: AM/PM, hour, minute (One UI puts AM/PM first)
  const periodName = (pm) => fmtPeriod(new Date(2024, 0, 1, pm ? 15 : 9)) || (pm ? 'PM' : 'AM');
  let hw, pw;
  const mw = wheel({ min: 0, max: 59, value: minute, onChange: (v) => { minute = v; refresh(); }, label: t('clock.minutes') });
  if (h12) {
    hw = wheel({ min: 1, max: 12, value: hour % 12 || 12, fmt: String, onChange: (v) => { hour = (v % 12) + (pw.get() ? 12 : 0); refresh(); }, label: t('clock.hours') });
    pw = wheel({ min: 0, max: 1, value: hour >= 12 ? 1 : 0, loop: false, fmt: periodName, onChange: (v) => { hour = (hw.get() % 12) + (v ? 12 : 0); refresh(); }, label: t('clock.ampm') });
    pw.classList.add('period');
  } else hw = wheel({ min: 0, max: 23, value: hour, onChange: (v) => { hour = v; refresh(); }, label: t('clock.hours') });
  const wheels = h('div', { class: 'clk-wheels', dir: 'ltr' }, pw || null, hw, h('span', { class: 'clk-colon' }, ':'), mw);

  const until = h('div', { class: 'clk-edit-until', 'aria-live': 'polite' });
  const dateText = h('div', { class: 'clk-edit-date' });
  const calBtn = iconBtn('calendar', () => pickDate(), t('clock.pickDate'));
  calBtn.classList.add('clk-edit-cal');
  const names = weekdayNames('narrow'), longNames = weekdayNames('long');
  const dayBtns = names.map((n, i) => h('button', { class: ['clk-day', i === 0 && 'sun'], title: longNames[i], 'aria-label': longNames[i], onClick: () => {
    a.days = a.days.includes(i) ? a.days.filter((x) => x !== i) : [...a.days, i].sort();
    if (a.days.length) a.date = '';
    refresh();
  } }, n));
  const name = h('input', { class: 'clk-edit-name', placeholder: t('clock.alarmName'), 'aria-label': t('clock.alarmName'), value: a.label, maxlength: 60 });

  const optRow = (title, getSub, getOn, setOn, open) => {
    const sub = h('span', { class: 'ou-row-sub' });
    const s = sw(getOn(), (v) => { setOn(v); refresh(); }, { label: title });
    const el = h('div', { class: 'ou-row clickable clk-opt', role: 'button', tabindex: 0, onClick: open, onKeydown: (e) => e.key === 'Enter' && e.target === el && open() },
      h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, title), sub), h('i', { class: 'clk-opt-div' }), s);
    el.sync = () => {
      sub.textContent = getSub();
      sub.classList.toggle('on', getOn());
      s.set(getOn());
    };
    return el;
  };
  const soundRow = optRow(t('clock.alarmSound'), () => toneName(a.sound), () => a.soundOn, (v) => (a.soundOn = v), () => open('sound'));
  soundRow.classList.add('clk-opt-sound');
  const snoozeRow = optRow(t('clock.snooze'), () => snoozeText(a), () => a.snooze, (v) => (a.snooze = v), () => open('snooze'));
  snoozeRow.classList.add('clk-opt-snooze');

  function refresh() {
    const d = draft();
    const at = nextAlarmTime(d);
    until.textContent = at ? t('clock.alarmIn', { d: fmtSpan(at - Date.now()) }) : t('clock.pastTime');
    dateText.textContent = a.days.length ? repeatText(a.days) : (() => {
      if (!at) return fmtDate(keyDate(a.date), { weekday: 'short', month: 'short', day: 'numeric' });
      const day = sameDay(at, Date.now()) ? t('common.today') : sameDay(at, Date.now() + 864e5) ? t('common.tomorrow') : '';
      const date = fmtDate(new Date(at), { weekday: 'short', month: 'short', day: 'numeric' });
      return day ? `${day} · ${date}` : date;
    })();
    calBtn.classList.toggle('on', !!a.date);
    dayBtns.forEach((b, i) => {
      b.classList.toggle('on', a.days.includes(i));
      b.setAttribute('aria-pressed', String(a.days.includes(i)));
    });
    soundRow.sync();
    snoozeRow.sync();
  }

  const main = h('div', { class: 'clk-edit-main' }, until, wheels,
    h('div', { class: 'clk-edit-card' },
      h('div', { class: 'clk-edit-dateline' }, dateText, calBtn),
      h('div', { class: 'clk-days' }, dayBtns),
      name),
    h('div', { class: 'ou-card ou-list clk-edit-opts' }, soundRow, snoozeRow));
  const sub = h('div', { class: 'clk-edit-sub' });
  const body = h('div', { class: 'clk-edit-body' }, main, sub);
  let leaveSub = null;

  // Alarm sound / Snooze open inside the pop-up, with a back arrow (One UI's tablet pop-ups navigate in place)
  function open(view) {
    const box = body.closest('.ou-dialog');
    const back = () => {
      leaveSub?.();
      leaveSub = null;
      box.classList.remove('clk-sub-on');
      sub.replaceChildren();
      refresh();
      (view === 'sound' ? soundRow : snoozeRow).focus();
    };
    const head = (title, getOn, setOn) => h('div', { class: 'clk-sub-head' },
      iconBtn('back', back, t('common.back')),
      h('div', { class: 'clk-sub-title' }, title),
      h('div', { class: ['clk-sub-switch', getOn() && 'on'] }, h('span', null, getOn() ? t('common.on') : t('common.off')),
        sw(getOn(), (v) => { setOn(v); sub.querySelector('.clk-sub-switch').classList.toggle('on', v); sub.querySelector('.clk-sub-switch > span').textContent = v ? t('common.on') : t('common.off'); }, { label: title })));
    if (view === 'sound') {
      const picker = soundPicker(a, () => {}, { gradual: true });
      leaveSub = () => picker.stop();
      sub.replaceChildren(head(t('clock.alarmSound'), () => a.soundOn, (v) => (a.soundOn = v)), h('div', { class: 'clk-sub-scroll' }, picker));
    } else {
      const ivl = radioList(C.SNOOZE_MINS.map((m) => ({ value: m, label: pl('clock.u.min', m) })), a.snoozeMin, (v) => { a.snoozeMin = v; a.snooze = true; });
      const rep = radioList(C.SNOOZE_REPEATS.map((r) => ({ value: r, label: r ? pl('clock.times', r) : t('clock.forever') })), a.snoozeRepeat, (v) => { a.snoozeRepeat = v; a.snooze = true; });
      sub.replaceChildren(head(t('clock.snooze'), () => a.snooze, (v) => (a.snooze = v)),
        h('div', { class: 'clk-sub-scroll' }, h('div', { class: 'ou-subheader' }, t('clock.interval')), ivl, h('div', { class: 'ou-subheader' }, t('clock.repeatTimes')), rep));
    }
    box.classList.add('clk-sub-on');
    setTimeout(() => sub.querySelector('.clk-sub-head .ou-icon-btn')?.focus(), 60);
  }

  async function pickDate() {
    const picked = await datePicker(a.date || C.dateKey(new Date(nextAlarmTime({ ...draft(), date: '', days: [] }) || Date.now())));
    if (!picked) return;
    a.date = picked;
    a.days = [];
    refresh();
  }

  refresh();
  const actions = [{ label: t('common.cancel'), value: null }];
  if (existing) actions.push({ label: t('common.delete'), value: 'delete', danger: true });
  actions.push({
    label: t('common.save'), value: 'save', primary: true,
    validate: () => {
      if (nextAlarmTime(draft())) return true;
      toast(t('clock.pastTime'));
      return false;
    },
  });
  const res = await dialog({ title: existing ? t('clock.editAlarm') : t('clock.addAlarm'), className: 'clk-edit', content: body, actions });
  leaveSub?.();
  stopSound();
  if (res === 'delete') {
    D.deleteAlarms([a.id]);
    toast(t('clock.deleted1'));
  } else if (res === 'save') {
    const saved = { ...draft(), label: name.value.trim(), snoozeCount: 0 };
    if (saved.days.length) saved.date = '';
    D.saveAlarm(saved);
    toast(t('clock.alarmSetFor', { d: fmtSpan(nextAlarmTime(saved) - Date.now()) }));
  }
  return res;
}

/** One UI's date picker pop-up (today onwards). Resolves 'YYYY-MM-DD' or null. */
export function datePicker(cur) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let picked = cur;
  let month = cur ? keyDate(cur) : new Date(today);
  month = new Date(month.getFullYear(), month.getMonth(), 1);
  const el = h('div', { class: 'clk-cal' });
  const draw = () => {
    const first = month.getDay(), days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const names = weekdayNames('narrow');
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(h('span'));
    for (let d = 1; d <= days; d++) {
      const date = new Date(month.getFullYear(), month.getMonth(), d), k = C.dateKey(date);
      cells.push(h('button', {
        class: ['clk-cal-day', k === picked && 'on', +date === +today && 'today', date.getDay() === 0 && 'sun'], disabled: date < today,
        'aria-pressed': String(k === picked), 'aria-label': fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' }),
        onClick: () => { picked = k; draw(); },
      }, String(d)));
    }
    const canBack = month > new Date(today.getFullYear(), today.getMonth(), 1);
    el.replaceChildren(
      h('div', { class: 'clk-cal-head' },
        h('button', { class: 'ou-icon-btn clk-cal-prev', disabled: !canBack, title: t('clock.prevMonth'), 'aria-label': t('clock.prevMonth'), html: icon('back', 20), onClick: () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); draw(); } }),
        h('div', { class: 'clk-cal-title' }, new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(month)),
        h('button', { class: 'ou-icon-btn clk-cal-next', title: t('clock.nextMonth'), 'aria-label': t('clock.nextMonth'), html: icon('forward', 20), onClick: () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); draw(); } })),
      h('div', { class: 'clk-cal-grid' }, names.map((n, i) => h('span', { class: ['clk-cal-wd', i === 0 && 'sun'] }, n)), cells));
  };
  draw();
  return dialog({ title: t('clock.pickDate'), className: 'clk-cal-dlg', content: el, actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => picked, primary: true }] });
}
