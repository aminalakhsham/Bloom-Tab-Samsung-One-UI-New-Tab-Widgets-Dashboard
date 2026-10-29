// The pause page (wellbeing-blocked.html). The service worker (js/bg/wellbeing.js) sends a site's tab here when its
// site timer ran out, while a Focus mode (or the Quick Panel's Focus) is on, or at bedtime. Three calm One UI screens:
// "Site paused" (the site's icon greyed under an hourglass, OK, One more minute, Ignore for today), "Focus mode is on"
// in the mode's colour, and "Bedtime mode is on" in night blue. URL: ?r=timer|focus|bedtime&s=<site>&k=<timer or mode
// id>&u=<the page>. It goes back to the page by itself once the reason is gone (the mode ended, the timer was raised…).
import { store } from '../core/store.js';
import { setLang, detectLang, t, fmtTime } from '../core/i18n.js';
import { applyTheme } from '../shell/theme.js';
import { h, everySecond } from '../core/util.js';
import { icon } from '../core/icons.js';
import * as M from './model.js';
import { categoryOf, CATS } from './categories.js';
import { prefs, usage, dur, modeName, siteIcon } from './common.js';
import './strings.js';

const q = new URLSearchParams(location.search);
const reason = ['timer', 'focus', 'bedtime'].includes(q.get('r')) ? q.get('r') : 'timer';
const site = q.get('s') || '', key = q.get('k') || '', url = q.get('u') || '';
const isExt = !!globalThis.chrome?.runtime?.id;
const $ = (s) => document.querySelector(s);

/** A sentence with the site's name isolated (so an Arabic sentence that starts with "youtube.com" still reads right). */
function withSite(key, vars = {}) {
  const mark = '⁣';
  const [a, b = ''] = t(key, { ...vars, site: mark }).split(mark);
  return [a, h('bdi', { class: 'wbb-site' }, site), b];
}

async function closeTab() {
  if (!isExt) return history.back();
  const tab = await chrome.tabs.getCurrent();
  const all = await chrome.tabs.query({ windowId: tab.windowId }).catch(() => [tab]);
  if (all.length > 1) chrome.tabs.remove(tab.id);
  else location.replace(chrome.runtime.getURL('newtab.html'));
}

async function allow(extra) {
  if (isExt) await chrome.runtime.sendMessage({ type: 'wb:allow', reason, site, key, ...extra }).catch(() => {});
  if (url) location.replace(url);
}

const btn = (label, onClick, cls = '', x = '') => h('button', { class: ['wbb-btn', cls], dataset: { x }, onClick }, label);

function render() {
  const w = prefs(), now = Date.now();
  const art = $('.wbb-art'), meta = $('.wbb-meta'), btns = $('.wbb-btns');
  let title, text;
  if (reason === 'focus') {
    const mode = key === 'session' ? null : w.modes.find((m) => m.id === key);
    document.documentElement.style.setProperty('--mc', mode?.color || '#8a5cf6');
    title = t('wellbeing.bk.focusTitle');
    text = mode ? withSite('wellbeing.bk.focusText', { mode: modeName(mode) }) : withSite('wellbeing.bk.sessionText');
    art.replaceChildren(h('span', { class: 'wbb-mode', html: icon(mode?.icon || 'dnd', 40) }));
    btns.replaceChildren(btn(t('wellbeing.bk.closeTab'), closeTab, 'primary', 'close'), btn(t('wellbeing.bk.use5'), () => allow({ minutes: 5 }), '', 'use5'));
  } else if (reason === 'bedtime') {
    const bt = M.bedtimeAt(w.bedtime, now);
    title = t('wellbeing.bk.bedTitle');
    text = withSite('wellbeing.bk.bedText', { time: fmtTime(new Date(bt.until || M.nextTimeOf(w.bedtime.to, now))) });
    art.replaceChildren(h('span', { class: 'wbb-moon', html: icon('bedtime', 44) }));
    btns.replaceChildren(btn(t('wellbeing.bk.closeTab'), closeTab, 'primary', 'close'), btn(t('wellbeing.bk.use15'), () => allow({ minutes: 15 }), '', 'use15'), btn(t('wellbeing.bk.tonight'), () => allow({ today: true }), '', 'today'));
  } else {
    const tm = w.timers.find((x) => x.id === key);
    title = t('wellbeing.bk.timerTitle');
    text = tm?.kind === 'cat' ? withSite('wellbeing.bk.catText', { cat: t('wellbeing.cat.' + (CATS[tm.target] ? tm.target : 'other')) }) : withSite('wellbeing.bk.timerText');
    const mins = tm ? M.timerMinutes(tm, now) : 0;
    meta.textContent = mins ? t('wellbeing.bk.timerMeta', { t: dur(mins * 60) }) : '';
    art.replaceChildren(h('span', { class: 'wbb-paused' }, siteIcon(site, 'wbb-sico'), h('span', { class: 'wbb-badge', html: icon('hourglass', 18) })));
    const ommUsed = usage().g.omm?.[site] === M.dayKey(now);
    btns.replaceChildren(
      btn(t('common.ok'), closeTab, 'primary', 'ok'),
      ommUsed ? null : btn(t('wellbeing.bk.omm'), () => allow({ minutes: 1, omm: true }), '', 'omm'),
      btn(t('wellbeing.bk.today'), () => allow({ today: true }), '', 'today'));
  }
  document.title = title;
  $('.wbb-title').textContent = title;
  $('.wbb-text').replaceChildren(...text);
}

/** The time left in a Focus mode or session, under the text. */
function tick() {
  if (reason !== 'focus') return;
  const w = prefs(), f = key === 'session' ? store.get('focus') : w.focus;
  const left = f?.endsAt ? f.endsAt - Date.now() : 0;
  $('.wbb-meta').textContent = left > 0 ? t('wellbeing.bk.left', { t: dur(left / 1000) }) : '';
}

/** Back to the page once nothing pauses it any more (the counting in progress included, as the service worker does). */
async function check() {
  if (!url) return;
  const w = prefs();
  let live = null;
  try {
    const { wbSeg } = await chrome.storage.session.get('wbSeg');
    if (wbSeg) live = { site: wbSeg.s, sec: (Date.now() - wbSeg.since) / 1000 };
  } catch {}
  const v = M.verdict(site, { w, focus: store.get('focus'), usage: usage(), now: Date.now(), catOf: (s) => categoryOf(s, w.cats), live });
  if (!v || v[0] !== reason) location.replace(url);
}

async function boot() {
  await store.init();
  setLang(detectLang());
  applyTheme();
  document.body.className = 'wbb-' + reason;
  render();
  everySecond(tick);
  // the first look waits a moment: the service worker saves the last seconds on this site right after sending us here
  setTimeout(() => {
    check();
    setInterval(check, 5000);
    ['wellbeing', 'focus', 'wellbeingUsage'].forEach((k) => store.on(k, () => { render(); check(); }));
  }, 2500);
}

boot();
