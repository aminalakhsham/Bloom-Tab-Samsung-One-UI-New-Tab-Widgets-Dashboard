// Voice Recorder (Samsung Voice Recorder style): registration, the Now Bar activity while recording, the Quick Panel
// tile, the widgets (Record button, recent recordings), the Finder command `record` and search. Everything else loads
// when the app opens (js/recorder/ui.js) or when a recording starts (js/recorder/engine.js).
import { h, sameDay } from '../core/util.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerActivity } from '../core/activity.js';
import { registerCommand, registerTile } from '../core/hooks.js';
import { store } from '../core/store.js';
import { addStrings, t, fmtTime, fmtDate } from '../core/i18n.js';
import { toast } from '../core/ui.js';
import { live, onLive } from '../recorder/live.js';
import { registerRecorderActions } from '../recorder/actions.js';

const RED = '#f4483f';
const p2 = (n) => String(n).padStart(2, '0');
const fmtLen = (sec) => {
  sec = Math.max(0, Math.round(sec || 0));
  const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return hh ? `${hh}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
};
// what the widgets and Finder need from the `recorder` key, without loading the app's modules
const lenOf = (m) => (m.segs?.length ? m.segs.reduce((a, [s, e]) => a + (e - s), 0) : m.dur || 0);
const recordings = () => ((store.get('recorder') || {}).items || []).filter((m) => m && m.id && !m.deletedAt && !m.rec).sort((a, b) => b.at - a.at);
const when = (at) => (sameDay(at, new Date()) ? fmtTime(new Date(at)) : fmtDate(new Date(at), { month: 'short', day: 'numeric' }));

/** Starts a Standard recording without opening the app (widget, Quick Panel). Must run from a click. */
export async function quickRecord() {
  try {
    const eng = await import('../recorder/engine.js');
    await eng.start({ mode: 'std' });
    toast(t('recorder.started'));
    return true;
  } catch (e) {
    (await import('../recorder/common.js')).micError(e);
    return false;
  }
}
/** Stops the recording in progress and saves it with its default name. */
export async function quickStop() {
  const r = live();
  if (!r) return;
  const title = r.title;
  await r.stop();
  toast(t('recorder.savedAs', { name: title }), { action: t('common.open'), onAction: () => openApp('recorder', { params: { id: r.id } }) });
}

registerRecorderActions({ stop: quickStop }); // Modes and Routines: Start recording, Stop recording

registerApp({
  id: 'recorder',
  name: 'app.recorder',
  icon: {
    bg: 'linear-gradient(150deg, #ff7a5c 0%, #f2304a 100%)',
    glyph: '<path d="M4.5 10.5v3M8.25 7.5v9M12 4.5v15M15.75 8v8M19.5 10v4"/>',
  },
  keywords: ['voice recorder', 'recorder', 'record', 'voice memo', 'audio', 'microphone', 'مسجل الصوت', 'تسجيل', 'مسجل', 'صوت'],
  size: 'phone',
  render: (ctx) => import('../recorder/ui.js').then((m) => m.render(ctx)),
  search(q) {
    q = q.toLocaleLowerCase();
    return recordings()
      .filter((m) => [m.title, ...(m.text || []).map((p) => p.s), ...(m.marks || []).map((b) => b.name || '')].some((s) => s && s.toLocaleLowerCase().includes(q)))
      .slice(0, 5)
      .map((m) => ({ title: m.title, sub: `${when(m.at)} · ${fmtLen(lenOf(m))}`, icon: 'mic', onOpen: () => openApp('recorder', { params: { id: m.id } }) }));
  },
});

// ——— Now Bar / Quick Panel activity ———
registerActivity('recorder', () => {
  const r = live();
  if (!r) return null;
  return {
    icon: 'mic',
    color: RED,
    title: fmtLen(r.elapsed()),
    sub: r.paused ? t('recorder.paused') : t('recorder.recording'),
    app: 'recorder',
    wave: !r.paused,
    priority: 30,
    actions: [
      { icon: 'stop', label: t('recorder.stop'), onClick: () => quickStop() },
      { icon: r.paused ? 'mic' : 'pause', label: r.paused ? t('recorder.resume') : t('recorder.pause'), onClick: () => r.toggle() },
    ],
  };
});

// ——— Quick Panel tile ———
registerTile({
  id: 'recorder',
  icon: 'mic',
  order: 60,
  label: () => t('recorder.tile'),
  on: () => !!live(),
  toggle() {
    // the panel redraws its tiles only when it opens, so the pressed state of this tile is set here
    const btn = document.activeElement?.closest?.('.qp-tile');
    const show = (on) => {
      btn?.classList.toggle('on', on);
      btn?.setAttribute('aria-pressed', String(on));
    };
    if (live()) quickStop().then(() => show(false));
    else quickRecord().then((ok) => show(ok));
  },
});

// ——— Finder: "record" ———
const CMD = /^(?:record|recording|rec|start recording|stop recording|voice recorder|voice record|تسجيل|سجل|سجّل|ابدأ التسجيل|أوقف التسجيل|مسجل الصوت|تسجيل صوت|تسجيل صوتي)$/;
registerCommand('recorder', (q, lower, done) => {
  if (!CMD.test(lower.trim())) return [];
  const r = live();
  if (r) return [{ icon: 'stop', title: t('recorder.cmdStop'), sub: `${t('app.recorder')} · ${fmtLen(r.elapsed())}`, run: () => { done?.(); quickStop(); } }];
  return [{ icon: 'mic', title: t('recorder.cmdRecord'), sub: t('app.recorder'), run: () => { done?.(); openApp('recorder', { params: { record: true } }); } }];
});

// ——— widgets ———
const recBtnSvg = (on) => (on ? '<svg viewBox="0 0 24 24" width="40%" height="40%"><rect x="5" y="5" width="14" height="14" rx="3" fill="#fff"/></svg>' : '<svg viewBox="0 0 24 24" width="38%" height="38%"><circle cx="12" cy="12" r="9" fill="#fff"/></svg>');

function recordWidget(el) {
  el.classList.add('wg-rec');
  let tick = 0;
  const draw = () => {
    const r = live();
    clearInterval(tick);
    el.classList.toggle('on', !!r);
    el.classList.toggle('paused', !!r?.paused);
    const status = h('div', { class: 'wg-rec-status', dir: r ? 'ltr' : null }, r ? fmtLen(r.elapsed()) : t('recorder.w.tap'));
    const big = h('button', {
      class: 'wg-rec-btn',
      title: r ? t('recorder.stop') : t('recorder.record'),
      'aria-label': r ? t('recorder.stop') : t('recorder.record'),
      html: recBtnSvg(!!r),
      onClick: (e) => {
        e.stopPropagation();
        if (live()) quickStop();
        else quickRecord();
      },
    });
    el.replaceChildren(
      h('div', { class: 'wg-head' }, h('span', { class: 'wg-rec-dot' }), h('span', null, r ? (r.paused ? t('recorder.paused') : t('recorder.recording')) : t('app.recorder'))),
      h('div', { class: 'wg-rec-mid' }, big),
      h('div', { class: 'wg-rec-foot' },
        status,
        r ? h('button', { class: 'wg-rec-pause', title: r.paused ? t('recorder.resume') : t('recorder.pause'), 'aria-label': r.paused ? t('recorder.resume') : t('recorder.pause'), html: r.paused ? '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor"/></svg>', onClick: (e) => { e.stopPropagation(); live()?.toggle(); } }) : null));
    if (r && !r.paused) tick = setInterval(() => (status.textContent = fmtLen(r.elapsed())), 1000);
  };
  draw();
  const off = onLive(draw);
  return () => {
    clearInterval(tick);
    off();
  };
}

function recentWidget(el, { size }) {
  el.classList.add('wg-recent');
  let tick = 0;
  const draw = () => {
    const r = live();
    clearInterval(tick);
    const list = recordings().slice(0, size === 'l' ? 7 : 3);
    const btn = h('button', {
      class: ['wg-recent-rec', r && 'on'],
      title: r ? t('recorder.stop') : t('recorder.record'),
      'aria-label': r ? t('recorder.stop') : t('recorder.record'),
      html: recBtnSvg(!!r),
      onClick: (e) => {
        e.stopPropagation();
        if (live()) quickStop();
        else quickRecord();
      },
    });
    const sub = h('span', { class: 'wg-recent-sub', dir: r ? 'ltr' : null }, r ? fmtLen(r.elapsed()) : '');
    el.replaceChildren(
      h('div', { class: 'wg-head' }, h('span', { class: 'wg-rec-dot' }), h('span', { class: 'wg-recent-title' }, r ? t('recorder.recording') : t('recorder.w.recent')), sub, btn),
      list.length
        ? h('div', { class: 'wg-recent-list' },
          list.map((m) =>
            h('button', { class: 'wg-recent-row', onClick: (e) => { e.stopPropagation(); openApp('recorder', { from: el, params: { id: m.id } }); } },
              h('span', { class: 'wg-recent-ico', html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 10.5v3M8.5 8v8M12 5v14M15.5 8.5v7M19 10.5v3"/></svg>' }),
              h('span', { class: 'wg-recent-text' }, h('b', null, m.title), h('small', null, when(m.at))),
              h('span', { class: 'wg-recent-len', dir: 'ltr' }, fmtLen(lenOf(m))))))
        : h('div', { class: 'wg-recent-empty' }, t('recorder.empty')));
    if (r && !r.paused) tick = setInterval(() => (sub.textContent = fmtLen(r.elapsed())), 1000);
  };
  draw();
  const off1 = onLive(draw), off2 = store.on('recorder', draw);
  return () => {
    clearInterval(tick);
    off1();
    off2();
  };
}

registerWidget({ id: 'recorder', name: 'recorder.w.record', sizes: ['s'], defaultSize: 's', app: 'recorder', render: recordWidget });
registerWidget({ id: 'recorder-recent', name: 'recorder.w.recent', sizes: ['m', 'l'], defaultSize: 'm', app: 'recorder', render: recentWidget });

addStrings({
  en: {
    'app.recorder': 'Voice Recorder',
    'recorder.record': 'Record',
    'recorder.recording': 'Recording',
    'recorder.paused': 'Paused',
    'recorder.pause': 'Pause',
    'recorder.resume': 'Resume',
    'recorder.stop': 'Stop',
    'recorder.tile': 'Voice recorder',
    'recorder.started': 'Recording started',
    'recorder.savedAs': 'Saved as {name}',
    'recorder.cmdRecord': 'Start recording',
    'recorder.cmdStop': 'Stop recording',
    'recorder.empty': 'No recordings',
    'recorder.name.std': 'Voice {n}',
    'recorder.name.interview': 'Interview {n}',
    'recorder.name.stt': 'Memo {n}',
    'recorder.w.record': 'Voice Recorder',
    'recorder.w.recent': 'Recordings',
    'recorder.w.tap': 'Tap to record',
  },
  ar: {
    'app.recorder': 'مسجل الصوت',
    'recorder.record': 'تسجيل',
    'recorder.recording': 'جارٍ التسجيل',
    'recorder.paused': 'متوقف مؤقتًا',
    'recorder.pause': 'إيقاف مؤقت',
    'recorder.resume': 'استئناف',
    'recorder.stop': 'إيقاف',
    'recorder.tile': 'مسجل الصوت',
    'recorder.started': 'بدأ التسجيل',
    'recorder.savedAs': 'تم الحفظ باسم {name}',
    'recorder.cmdRecord': 'بدء التسجيل',
    'recorder.cmdStop': 'إيقاف التسجيل',
    'recorder.empty': 'لا توجد تسجيلات',
    'recorder.name.std': 'صوت {n}',
    'recorder.name.interview': 'مقابلة {n}',
    'recorder.name.stt': 'مذكرة {n}',
    'recorder.w.record': 'مسجل الصوت',
    'recorder.w.recent': 'التسجيلات',
    'recorder.w.tap': 'اضغط للتسجيل',
  },
});

