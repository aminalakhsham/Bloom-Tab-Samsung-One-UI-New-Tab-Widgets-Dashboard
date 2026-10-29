// Shell widgets: Now Brief, Stack, Battery, Daily quote, Photo, Sounds, Focus.
import { h, everyMinute, everySecond, pickFile, readImage, startOfDay } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, tr, addStrings, lang, fmtDate, fmtTime } from '../core/i18n.js';
import { store, setting } from '../core/store.js';
import { registerWidget, getWidget } from '../core/widgets.js';
import * as B from './brief.js';
import { getBattery, batteryIcon } from './statusbar.js';
import * as sounds from './sounds.js';
import { startFocus, stopFocus, focusActive } from './quickpanel.js';

// ——— Now Brief ———
// The same data as the Now Brief sheet and the Lock screen card (js/shell/brief.js): today's brief until the evening
// brief time, then the evening brief. A tap opens the sheet.
function greeting(d = new Date()) {
  const hr = d.getHours();
  return t(hr < 5 ? 'brief.night' : hr < 12 ? 'brief.morning' : hr < 18 ? 'brief.afternoon' : 'brief.evening');
}

function briefLines(d) {
  if (d.kind === 'evening') {
    const tm = d.tomorrow;
    return [
      d.rings ? ['nbRings', B.goalsText(d.rings.closed), ''] : null,
      ['calendar', tm ? tm.title : B.dayKey(d.day) === B.dayKey(d.now) ? t('brief.noEventsToday') : t('brief.noEventsTomorrow'), tm ? tm.time : ''],
      ['alarm', d.alarm ? t('brief.alarmAt', { time: fmtTime(new Date(d.alarm)) }) : t('brief.noAlarm'), d.alarm ? '' : t('brief.setAlarm')],
      d.prompt ? ['nbJournal', t('brief.writeToday'), ''] : null,
    ].filter(Boolean);
  }
  const ev = d.events, r = d.reminders, md = d.meds, p = d.puzzles;
  return [
    ev.length ? ['calendar', ev[0].title, ev[0].time + (ev.length > 1 ? ' · ' + t('brief.more', { n: ev.length - 1 }) : '')] : ['calendar', t('brief.noEvents'), ''],
    r.total ? ['checkCircle', B.cnt('brief.remindersN', r.total), r.titles[0] || ''] : ['checkCircle', t('brief.noReminders'), ''],
    md?.left ? ['nbPill', md.next ? t('brief.nextDose', { time: md.next.time }) : B.cnt('brief.dosesDue', md.due), t('brief.taken', { n: md.taken, total: md.total })] : null,
    d.birthdays[0] ? ['nbCake', d.birthdays[0].age ? t('brief.turns', { name: d.birthdays[0].name, n: d.birthdays[0].age }) : t('brief.bdayOf', { name: d.birthdays[0].name }), ''] : null,
    d.bills[0] ? ['nbReceipt', d.bills[0].name, `${d.bills[0].when} · ⁨${d.bills[0].amountText}⁩`] : null,
    p?.total ? ['nbPuzzle', t('brief.puzzles'), t('brief.solved', { n: p.solved, total: p.total })] : null,
  ].filter(Boolean);
}

registerWidget({
  id: 'now-brief',
  name: 'brief.name',
  sizes: ['m', 'l', 's'],
  render(el, { size }) {
    el.classList.add('wg-brief');
    let alive = true, seq = 0;
    const paint = (now, d) => {
      const night = d?.kind === 'evening', wx = d?.weather;
      el.classList.toggle('night', night);
      const max = size === 's' ? 2 : size === 'm' ? 4 : 7;
      const lines = d ? briefLines(d).slice(0, max) : [];
      el.replaceChildren(
        h('div', { class: 'brief-head' },
          h('div', null, h('div', { class: 'brief-hello' }, greeting(now)), h('div', { class: 'brief-date' }, fmtDate(now, size === 's' ? { weekday: 'short', day: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric' }))),
          wx ? h('span', { class: 'brief-temp' }, h('span', { class: 'brief-wx', title: wx.label, html: wx.icon }), size === 's' ? null : wx.temp) : h('span', { class: 'brief-badge', html: icon(night ? 'moon' : 'sparkle', 18) })),
        h('div', { class: 'brief-list' },
          lines.map(([ic, a, b]) => h('div', { class: 'brief-row' }, h('span', { class: 'brief-ico', html: icon(ic, 16) }), h('span', { class: 'brief-text' }, h('b', null, a), b && size !== 's' ? h('small', null, b) : null)))),
        ...(size === 'l' && d?.rings && !night ? [h('div', { class: 'brief-rings' }, h('span', { html: d.rings.svg({ width: 13, gap: 3 }) }), h('span', null, B.goalsText(d.rings.closed)))] : []));
    };
    const draw = async () => {
      const n = ++seq, now = new Date();
      const d = await B.data(B.kindNow(now), now);
      if (alive && n === seq) paint(now, d);
    };
    paint(new Date(), null);
    let t0 = 0;
    const soon = () => { clearTimeout(t0); t0 = setTimeout(draw, 250); };
    const offs = [everyMinute(() => draw()), ...['weather', 'events', 'reminders', 'alarms', 'health', 'contacts', 'wallet', 'games', 'journal', 'settings'].map((k) => store.on(k, soon))];
    return () => {
      alive = false;
      clearTimeout(t0);
      offs.forEach((f) => f());
    };
  },
  onClick: () => B.openBrief(),
});

// ——— Stack (One UI's smart stack) ———
// A pile of widgets in one place that turns to what fits the time of day (the Now Brief first in the morning, Daily
// activity in the day, the journal in the evening, the evening brief at night; a running Focus session on top). Swipe,
// drag, scroll or use ←/→ to see the others; the dots under it show where you are. Each card is drawn by the widget's
// own renderer.
export const STACK = {
  morning: ['now-brief', 'weather', 'calendar-upcoming', 'calendar-month', 'reminder', 'games-today', 'health-rings'],
  day: ['health-rings', 'calendar-upcoming', 'calendar-month', 'reminder', 'focus', 'weather', 'notes'],
  evening: ['journal', 'health-rings', 'calendar-upcoming', 'calendar-month', 'weather', 'games-today', 'music'],
  night: ['now-brief', 'journal', 'health-rings', 'sounds', 'clock-digital', 'weather'],
};
/** The stack's cards for a part of the day, in a size: [widget id]. */
export function stackCards(phase = B.phaseNow(), size = 'm') {
  const ids = [...(focusActive() ? ['focus'] : []), ...(STACK[phase] || STACK.day)];
  return [...new Set(ids)].filter((id) => getWidget(id)?.sizes.includes(size)).slice(0, 6);
}

registerWidget({
  id: 'stack',
  name: 'stack.name',
  sizes: ['m', 's', 'l'],
  render(el, { size, preview }) {
    el.classList.add('wg-fill', 'wg-stack');
    let cleanups = [], sig = '', idx = 0;
    const track = h('div', { class: 'stk-track', 'data-scroll': '', role: 'list', tabindex: 0, 'aria-label': t('stack.name') });
    const dots = h('div', { class: 'stk-dots', 'aria-hidden': 'true' });
    el.replaceChildren(track, dots);
    const rtl = () => getComputedStyle(track).direction === 'rtl';
    const showDots = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i === idx));
    const build = () => {
      const ids = stackCards(B.phaseNow(), size);
      if (ids.join() === sig) return;
      sig = ids.join();
      cleanups.forEach((c) => c());
      cleanups = [];
      track.replaceChildren(...ids.map((id) => {
        const w = getWidget(id);
        const box = h('div', { class: ['wg', `w-${size}`] });
        const card = h('div', { class: 'stk-card', role: 'listitem', dataset: { card: id } }, box);
        try {
          const c = w.render(box, { size, item: { id: 'stack-' + id, widget: id, size, config: {} }, config: {}, setConfig() {}, preview });
          if (typeof c === 'function') cleanups.push(c);
        } catch (e) {
          console.error('stack', id, e);
        }
        box.setAttribute('aria-label', tr(w.name));
        return card;
      }));
      dots.replaceChildren(...ids.map(() => h('i')));
      // a new order (another part of the day) turns the stack back to its first card
      idx = 0;
      track.scrollLeft = 0;
      showDots();
    };
    const goTo = (i, smooth = true) => {
      const n = track.children.length;
      idx = Math.max(0, Math.min(n - 1, i));
      track.scrollTo({ left: (rtl() ? -1 : 1) * idx * track.clientWidth, behavior: smooth && !setting('reduceMotion') ? 'smooth' : 'auto' });
      showDots();
    };
    el._stackGo = goTo;
    track.addEventListener('scroll', () => {
      const i = Math.round(Math.abs(track.scrollLeft) / Math.max(1, track.clientWidth));
      if (i !== idx) {
        idx = i;
        showDots();
      }
    }, { passive: true });
    // the wheel turns one card at a time and stays inside the stack (the Home screen would change page)
    let acc = 0, lockT = 0, accT = 0;
    track.addEventListener('wheel', (e) => {
      if (e.ctrlKey || track.children.length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() < lockT) return;
      const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      acc += horiz ? e.deltaX * (rtl() ? -1 : 1) : e.deltaY;
      clearTimeout(accT);
      accT = setTimeout(() => (acc = 0), 180);
      if (Math.abs(acc) >= 40) {
        goTo(idx + Math.sign(acc));
        acc = 0;
        lockT = Date.now() + 420;
      }
    }, { passive: false });
    // a mouse drag swipes (touch scrolls natively); a long press opens the widget's menu like any Home screen item
    let drag = null, lp = 0, suppress = false;
    track.addEventListener('pointerdown', (e) => {
      if (preview || e.button !== 0 || document.body.classList.contains('home-edit')) return;
      e.stopPropagation();
      if (e.target.closest('button, input, textarea, select, a')) return;
      drag = { x: e.clientX, left: track.scrollLeft, id: e.pointerId, moved: false, mouse: e.pointerType !== 'touch' };
      clearTimeout(lp);
      lp = setTimeout(() => {
        if (!drag || drag.moved) return;
        drag = null;
        suppress = true;
        el.closest('.tile')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
      }, 520);
    });
    track.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 7) return;
      if (!drag.moved) {
        drag.moved = true;
        clearTimeout(lp);
        if (!drag.mouse) return;
        track.classList.add('dragging');
        track.setPointerCapture(drag.id);
      }
      if (drag.mouse) track.scrollLeft = drag.left - dx;
    });
    const end = (e) => {
      clearTimeout(lp);
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!d.moved) return;
      suppress = true;
      setTimeout(() => (suppress = false), 0);
      if (!d.mouse) return;
      track.classList.remove('dragging');
      const dx = e.clientX - d.x, w = track.clientWidth, from = Math.round(Math.abs(d.left) / Math.max(1, w));
      goTo(Math.abs(dx) > w * 0.18 ? from + (dx < 0 ? 1 : -1) * (rtl() ? -1 : 1) : from);
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    // a tap on a card does what that widget does on the Home screen
    track.addEventListener('click', (e) => {
      if (suppress) {
        suppress = false;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (preview || e.target.closest('button, input, textarea, select, a, [data-noopen]')) return;
      const card = e.target.closest('.stk-card');
      const w = card && getWidget(card.dataset.card);
      if (!w) return;
      e.stopPropagation();
      if (w.onClick) w.onClick({ id: 'stack-' + w.id, widget: w.id, size, config: {} }, card, e);
      else if (w.app) import('../core/apps.js').then((m) => m.openApp(w.app, { from: card }));
    });
    track.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      goTo(idx + ((e.key === 'ArrowRight') !== rtl() ? 1 : -1));
    });
    build();
    const stop = everyMinute(() => build());
    const offs = [store.on('focus', build), store.on('settings', build)];
    return () => {
      stop();
      offs.forEach((f) => f());
      cleanups.forEach((c) => c());
      clearTimeout(lp);
    };
  },
  onClick: () => {},
});

// ——— Battery ———
registerWidget({
  id: 'battery',
  name: 'battery.name',
  sizes: ['s'],
  render(el) {
    el.classList.add('wg-battery');
    let b = null;
    const draw = () => {
      if (!b) {
        el.replaceChildren(h('div', { class: 'batt-none' }, h('span', { html: icon('battery', 32) }), t('battery.unavailable')));
        return;
      }
      const pct = Math.round(b.level * 100);
      const C = 2 * Math.PI * 42;
      let sub = b.charging ? t('battery.charging') : '';
      if (!b.charging && isFinite(b.dischargingTime) && b.dischargingTime > 0) {
        const hh = Math.floor(b.dischargingTime / 3600), mm = Math.round((b.dischargingTime % 3600) / 60);
        sub = t('battery.left', { h: hh, m: mm });
      } else if (b.charging && isFinite(b.chargingTime) && b.chargingTime > 0) {
        sub = t('battery.full', { m: Math.round(b.chargingTime / 60) });
      }
      const color = pct <= 15 && !b.charging ? '#ff4d4f' : b.charging ? '#2fc26b' : 'var(--accent)';
      el.innerHTML = `<div class="batt-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-opacity=".14" stroke-width="9"/><circle cx="50" cy="50" r="42" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(C * b.level).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/></svg><span class="batt-ico">${batteryIcon(b.level, b.charging, 30)}</span></div><div class="batt-pct">${pct}%</div><div class="batt-sub">${sub}</div>`;
    };
    getBattery().then((x) => {
      b = x;
      draw();
      b?.addEventListener('levelchange', draw);
      b?.addEventListener('chargingchange', draw);
    });
    draw();
    return () => {
      b?.removeEventListener('levelchange', draw);
      b?.removeEventListener('chargingchange', draw);
    };
  },
});

// ——— Daily quote ———
const QUOTES = {
  en: [
    ['The best way out is always through.', 'Robert Frost'],
    ['Well begun is half done.', 'Aristotle'],
    ['It does not matter how slowly you go as long as you do not stop.', 'Confucius'],
    ['The journey of a thousand miles begins with one step.', 'Lao Tzu'],
    ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
    ['What you do today can improve all your tomorrows.', 'Ralph Marston'],
    ['Waste no more time arguing what a good man should be. Be one.', 'Marcus Aurelius'],
    ['Luck is what happens when preparation meets opportunity.', 'Seneca'],
    ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
    ['Nothing will work unless you do.', 'Maya Angelou'],
    ['Well done is better than well said.', 'Benjamin Franklin'],
    ['Go confidently in the direction of your dreams.', 'Henry David Thoreau'],
    ['Quality is not an act, it is a habit.', 'Aristotle'],
    ['The secret of getting ahead is getting started.', 'Mark Twain'],
    ['Little by little, one travels far.', 'J. R. R. Tolkien'],
    ['Whatever you are, be a good one.', 'Abraham Lincoln'],
    ['Write it on your heart that every day is the best day in the year.', 'Ralph Waldo Emerson'],
    ['Be where you are; otherwise you will miss your life.', 'Buddha'],
    ['Patience is bitter, but its fruit is sweet.', 'Aristotle'],
    ['What we think, we become.', 'Buddha'],
    ['The present moment always will have been.', 'Rumi'],
    ['Make each day your masterpiece.', 'John Wooden'],
    ['Begin anywhere.', 'John Cage'],
    ['Done is better than perfect.', 'Proverb'],
  ],
  ar: [
    ['من جدّ وجد، ومن زرع حصد.', 'مثل عربي'],
    ['العلم في الصغر كالنقش على الحجر.', 'مثل عربي'],
    ['ما ضاع حق وراءه مطالب.', 'مثل عربي'],
    ['خير الكلام ما قلّ ودلّ.', 'مثل عربي'],
    ['الصبر مفتاح الفرج.', 'مثل عربي'],
    ['اطلبوا العلم من المهد إلى اللحد.', 'حكمة'],
    ['قيمة كل امرئ ما يحسنه.', 'علي بن أبي طالب'],
    ['إذا هبّت رياحك فاغتنمها.', 'مثل عربي'],
    ['على قدر أهل العزم تأتي العزائم.', 'المتنبي'],
    ['من سار على الدرب وصل.', 'مثل عربي'],
    ['الوقت كالسيف إن لم تقطعه قطعك.', 'مثل عربي'],
    ['لا تؤجل عمل اليوم إلى الغد.', 'مثل عربي'],
  ],
};

export function dailyQuote(d = new Date()) {
  const list = QUOTES[lang()] || QUOTES.en;
  const day = Math.floor((startOfDay(d).getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 864e5);
  return list[day % list.length];
}

registerWidget({
  id: 'quote',
  name: 'quote.name',
  sizes: ['m', 's'],
  render(el) {
    el.classList.add('wg-quote');
    const draw = () => {
      const [q, a] = dailyQuote();
      el.replaceChildren(h('span', { class: 'quote-mark' }, '“'), h('div', { class: 'quote-text' }, q), h('div', { class: 'quote-by' }, a));
    };
    draw();
    return everyMinute((d) => d.getHours() === 0 && d.getMinutes() === 0 && draw());
  },
});

// ——— Photo ———
registerWidget({
  id: 'photo',
  name: 'photo.name',
  sizes: ['s', 'm', 'l'],
  render(el, { config, setConfig, preview }) {
    el.classList.add('wg-fill', 'wg-photo');
    const pick = async (e) => {
      e?.stopPropagation();
      if (preview) return;
      const f = await pickFile('image/*');
      if (!f) return;
      const src = await readImage(f, 1000, 0.85);
      setConfig({ src });
      el.style.backgroundImage = `url("${src}")`;
      el.replaceChildren();
    };
    if (config.src) el.style.backgroundImage = `url("${config.src}")`;
    else el.replaceChildren(h('button', { class: 'photo-add', 'data-noopen': '', onClick: pick }, h('span', { html: icon('image', 30) }), t('photo.add')));
    el._pick = pick;
  },
  onClick: (item, tile) => tile.querySelector('.wg')?._pick?.(),
});

// ——— Sounds ———
registerWidget({
  id: 'sounds',
  name: 'sound.title',
  sizes: ['s'],
  render(el) {
    el.classList.add('wg-sounds');
    const draw = (st = sounds.state()) => {
      const s = st.sound || sounds.SOUNDS.find((x) => x.id === (setting('lastSound') || 'rain'));
      el.style.setProperty('--media', s.color);
      el.classList.toggle('playing', st.playing);
      el.replaceChildren(
        h('div', { class: 'snd-art', html: icon(s.icon, 26) }),
        h('div', { class: 'snd-name' }, sounds.soundName(s.id)),
        h('div', { class: 'snd-ctrls' },
          h('button', { class: 'snd-btn', 'aria-label': t('sound.prev'), html: icon('prev', 16), onClick: () => sounds.step(-1) }),
          h('button', { class: 'snd-btn play', 'aria-label': st.playing ? t('sound.pause') : t('sound.play'), html: icon(st.playing ? 'pause' : 'play', 18), onClick: () => sounds.toggle() }),
          h('button', { class: 'snd-btn', 'aria-label': t('sound.next'), html: icon('next', 16), onClick: () => sounds.step(1) })));
    };
    draw();
    return sounds.onSoundChange(draw);
  },
  onClick: () => import('./quickpanel.js').then((m) => m.openQuickPanel()),
});

// ——— Focus ———
registerWidget({
  id: 'focus',
  name: 'qp.focus',
  sizes: ['s'],
  render(el) {
    el.classList.add('wg-focus');
    const C = 2 * Math.PI * 40;
    const draw = () => {
      const f = store.get('focus');
      const on = focusActive();
      // "Until I turn it off" (endsAt null): the time so far counts up and the ring stays full
      const open = on && f.endsAt == null;
      const left = open ? Date.now() - f.startedAt : on ? f.endsAt - Date.now() : setting('focusMinutes') * 60e3;
      const p = open ? 1 : on ? 1 - left / (f.endsAt - f.startedAt) : 0;
      const mm = Math.floor(left / 60e3), ss = Math.floor((left % 60e3) / 1000);
      el.classList.toggle('on', on);
      el.innerHTML = `<div class="focus-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-opacity=".14" stroke-width="8"/><circle cx="50" cy="50" r="40" fill="none" stroke="#8a5cf6" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/></svg><span class="focus-time">${mm}:${String(ss).padStart(2, '0')}</span></div>`;
      el.appendChild(h('button', { class: 'focus-btn', onClick: () => (on ? stopFocus() : startFocus()) }, on ? t('focus.stop') : t('focus.start')));
    };
    draw();
    const stop = everySecond(() => focusActive() && draw());
    const off = store.on('focus', draw);
    return () => {
      stop();
      off();
    };
  },
  onClick: () => {},
});

addStrings({
  en: {
    'brief.name': 'Now Brief',
    'stack.name': 'Smart stack',
    'brief.morning': 'Good morning',
    'brief.afternoon': 'Good afternoon',
    'brief.evening': 'Good evening',
    'brief.night': 'Good night',
    'brief.noEvents': 'No more events today',
    'brief.noReminders': 'No reminders due today',
    'battery.name': 'Battery',
    'battery.unavailable': 'Battery info unavailable',
    'battery.charging': 'Charging',
    'battery.left': '{h}h {m}m left',
    'battery.full': 'Full in {m} min',
    'quote.name': 'Daily quote',
    'photo.name': 'Photo',
    'photo.add': 'Add photo',
    'focus.start': 'Start',
    'focus.stop': 'Stop',
  },
  ar: {
    'brief.name': 'الموجز الآن',
    'stack.name': 'المجموعة الذكية',
    'brief.morning': 'صباح الخير',
    'brief.afternoon': 'مساء الخير',
    'brief.evening': 'مساء الخير',
    'brief.night': 'تصبح على خير',
    'brief.noEvents': 'لا مزيد من الأحداث اليوم',
    'brief.noReminders': 'لا توجد تذكيرات مستحقة اليوم',
    'battery.name': 'البطارية',
    'battery.unavailable': 'معلومات البطارية غير متاحة',
    'battery.charging': 'جارٍ الشحن',
    'battery.left': 'متبقٍ {h} س {m} د',
    'battery.full': 'يكتمل خلال {m} دقيقة',
    'quote.name': 'اقتباس اليوم',
    'photo.name': 'صورة',
    'photo.add': 'إضافة صورة',
    'focus.start': 'ابدأ',
    'focus.stop': 'إيقاف',
  },
});
