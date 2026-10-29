// One UI 9 status bar: bigger, bolder; time on the left, system icons on the right.
// Clicking it (or pulling down from the top) opens the Quick Panel.
import { h, $, everyMinute } from '../core/util.js';
import { icon } from '../core/icons.js';
import { fmtHM, fmtPeriod, t, addStrings } from '../core/i18n.js';
import { store } from '../core/store.js';
import { openQuickPanel } from './quickpanel.js';
import { dndActive } from '../bg/hub.js';

let battery = null;

export async function getBattery() {
  if (battery) return battery;
  try {
    battery = await navigator.getBattery?.();
  } catch {}
  return battery;
}

export function batteryIcon(level = 1, charging = false, size = 22) {
  const w = Math.max(1.5, 12.5 * level);
  const fill = level <= 0.15 && !charging ? '#ff4d4f' : 'currentColor';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="7" width="17" height="10" rx="3" fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="1.6"/><rect x="4.75" y="9.25" width="${w}" height="5.5" rx="1.4" fill="${fill}"/><path d="M21.2 10.3v3.4" stroke="currentColor" stroke-opacity=".5" stroke-width="1.8" stroke-linecap="round"/>${charging ? '<path d="M11.9 7.6 9.4 12.4h3l-1.2 4 3.4-5.3h-3l1.3-3.5Z" fill="currentColor" stroke="var(--sb-stroke,#000)" stroke-width=".6"/>' : ''}</svg>`;
}

let drawRight = null;
export function initStatusbar() {
  const el = $('#statusbar');
  const time = h('span', { class: 'sb-time' });
  const notifs = h('span', { class: 'sb-notifs' });
  const right = h('span', { class: 'sb-right' });
  el.replaceChildren(h('button', { class: 'sb-inner', 'aria-label': t('sb.open'), onClick: () => openQuickPanel() }, h('span', { class: 'sb-left' }, time, notifs), right));

  everyMinute((d) => {
    const p = fmtPeriod(d);
    time.textContent = fmtHM(d) + (p ? ' ' + p : '');
    // a Do not disturb schedule starts and ends on the minute
    if (d.getSeconds() < 2 && drawRight) drawRight();
  });

  drawRight = async () => {
    const b = await getBattery();
    const focus = store.get('focus');
    const s = store.get('settings');
    // Do not disturb (on, or its schedule running: Settings › Notifications) and Focus share One UI's minus-in-a-circle
    // icon: one icon, titled after Do not disturb when both are on
    const dnd = dndActive(s.dnd), focusOn = !!(focus && (focus.endsAt == null ? focus.startedAt : focus.endsAt > Date.now()));
    right.innerHTML =
      (dnd ? `<span class="sb-ico sb-dnd" title="${t('sb.dnd')}">${icon('dnd', 20)}</span>` : focusOn ? `<span class="sb-ico" title="${t('sb.focus')}">${icon('dnd', 20)}</span>` : '') +
      (s.eyeComfort ? `<span class="sb-ico">${icon('eyeComfort', 20)}</span>` : '') +
      `<span class="sb-ico" title="${navigator.onLine ? t('sb.online') : t('sb.offline')}">${navigator.onLine ? icon('wifi', 20) : icon('airplane', 20)}</span>` +
      (b ? `<span class="sb-batt">${Math.round(b.level * 100)}%${batteryIcon(b.level, b.charging)}</span>` : '');
  };
  drawRight();
  getBattery().then((b) => {
    if (!b) return;
    b.addEventListener('levelchange', drawRight);
    b.addEventListener('chargingchange', drawRight);
  });
  addEventListener('online', drawRight);
  addEventListener('offline', drawRight);
  store.on('focus', drawRight);
  store.on('settings', drawRight);

  const drawNotifs = () => {
    const list = (store.get('notifications') || []).filter((n) => !n.read).slice(0, 4);
    const apps = [...new Set(list.map((n) => n.icon || 'bell'))].slice(0, 3);
    notifs.innerHTML = apps.map((a) => icon(a, 17)).join('');
  };
  drawNotifs();
  store.on('notifications', drawNotifs);
}

addStrings({
  en: { 'sb.open': 'Open Quick panel', 'sb.focus': 'Focus on', 'sb.dnd': 'Do not disturb on', 'sb.online': 'Online', 'sb.offline': 'Offline' },
  ar: { 'sb.open': 'فتح اللوحة السريعة', 'sb.focus': 'وضع التركيز قيد التشغيل', 'sb.dnd': 'عدم الإزعاج قيد التشغيل', 'sb.online': 'متصل', 'sb.offline': 'غير متصل' },
});
