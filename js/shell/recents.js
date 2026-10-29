// One UI Recents screen: the open app windows as cards (tap to open, swipe up or × to close, Close all, the app
// icon's menu for split screen / pop-up view), your Chrome tabs (optional `tabs` permission: switch to or close a
// tab), Recently closed (optional `sessions`) and Workspaces (S12, store key `workspaces`: the websites open in this
// Chrome window saved under a name and reopened later as a named Chrome tab group; optional `tabGroups` names and
// colours the group).
// Opens with Alt+R (keys.js), the gesture bar at the bottom of the screen (swipe up or click), the Quick Panel's
// Recents tile, Finder ("recents", "workspaces", a workspace's name) and openApp('recents').
import { h, clamp, uid, hostname, faviconUrl, isExt, debounce, onLongPress } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t, addStrings, isRtl } from '../core/i18n.js';
import { store } from '../core/store.js';
import { toast, menu, dialog, confirm, prompt, btn } from '../core/ui.js';
import { registerApp, openApp, closeApp, appName, appIconEl, openWindows, onWindowsChange, closeAllApps, splitApp, popupApp } from '../core/apps.js';
import { registerTile, registerCommand } from '../core/hooks.js';
import { has, ensure } from '../core/perm.js';
import { isLocked } from './lock.js';

addIcons({
  workspace: '<rect x="3.5" y="7.5" width="13" height="12" rx="2.5"/><path d="M7.5 7.5V6A1.5 1.5 0 0 1 9 4.5h10A1.5 1.5 0 0 1 20.5 6v8.5A1.5 1.5 0 0 1 19 16h-2.5"/>',
});

const C = globalThis.chrome;
// Chrome's tab group colours, used in this order for new workspaces
const COLORS = ['blue', 'purple', 'green', 'orange', 'pink', 'cyan', 'red', 'yellow'];
const SWATCH = { grey: '#8e8e93', blue: '#3e7bff', red: '#f4483f', yellow: '#f5b400', green: '#1fb35a', pink: '#ec4c8a', purple: '#9b5cf6', cyan: '#12b5cb', orange: '#ff8a1f' };

let root = null, scroller = null, appsRow = null, tabsBox = null, bottomBox = null, closeAllBtn = null;
let offWin = null, offTabs = null, onKeyRef = null, renderSeq = 0;

export const isRecentsOpen = () => !!root;
export const toggleRecents = () => (root ? closeRecents() : openRecents());

export function openRecents() {
  if (root || isLocked()) return;
  appsRow = h('div', { class: 'rc-row rc-apps', role: 'list' });
  tabsBox = h('div', { class: 'rc-tabs-box' });
  bottomBox = h('div', { class: 'rc-bottom' });
  closeAllBtn = h('button', { class: 'rc-closeall', onClick: () => closeAllApps() }, t('recents.closeAll'));
  scroller = h('div', { class: 'rc-scroll scroll' }, appsRow, tabsBox, bottomBox);
  root = h('div', { id: 'recents', role: 'dialog', 'aria-label': t('recents.title') }, scroller, closeAllBtn);
  // tapping the empty background goes back, like One UI
  root.addEventListener('click', (e) => {
    if (e.target === root || e.target === scroller || e.target === appsRow || e.target.classList.contains('rc-empty')) closeRecents();
  });
  document.body.appendChild(root);
  document.body.classList.add('recents-open');
  renderApps();
  renderTabs();
  offWin = onWindowsChange(() => root && renderApps());
  onKeyRef = onKey;
  addEventListener('keydown', onKeyRef, true);
  if (isExt && C?.tabs) {
    // keep the tabs in step while the screen is up (closing one here, or elsewhere)
    const re = debounce(() => root && renderTabs(), 150);
    const evs = [C.tabs.onCreated, C.tabs.onRemoved, C.tabs.onUpdated, C.tabs.onActivated];
    evs.forEach((ev) => ev?.addListener(re));
    offTabs = () => evs.forEach((ev) => ev?.removeListener(re));
  }
  requestAnimationFrame(() => root?.classList.add('show'));
  setTimeout(() => (root?.querySelector('.rc-card') || closeAllBtn)?.focus({ preventScroll: true }), 30);
}

export function closeRecents() {
  if (!root) return;
  const r = root;
  root = scroller = appsRow = tabsBox = bottomBox = closeAllBtn = null;
  offWin?.();
  offTabs?.();
  offWin = offTabs = null;
  removeEventListener('keydown', onKeyRef, true);
  document.body.classList.remove('recents-open');
  r.classList.remove('show');
  r.classList.add('closing');
  setTimeout(() => r.remove(), document.documentElement.dataset.motion === 'reduce' ? 0 : 240);
}

// ——— app cards ———
function renderApps() {
  const list = openWindows();
  const cardH = Math.round(clamp(innerHeight * 0.4, 200, 400));
  root.style.setProperty('--card-h', cardH + 'px');
  closeAllBtn.hidden = !list.length;
  if (!list.length) {
    appsRow.replaceChildren(h('div', { class: 'rc-empty' }, t('recents.noApps')));
    return;
  }
  appsRow.replaceChildren(...list.map((w, i) => appCard(w, i, cardH)));
  // the clones' scroll positions can only be set once they are in the page
  for (const card of appsRow.querySelectorAll('.rc-card')) card._syncScroll?.();
}

function appCard(w, i, cardH) {
  const shot = h('div', { class: 'rc-shot' });
  const W = w.win.offsetWidth || 460, H = w.win.offsetHeight || 700;
  shot.style.width = Math.round(cardH * clamp(W / H, 0.45, 1.9)) + 'px';
  const copy = snapshot(w.win);
  copy.style.transform = `scale(${(cardH / H).toFixed(4)})`;
  shot.appendChild(copy);
  const name = appName(w.app);
  const card = h('div', {
    class: ['rc-card', w.minimized && 'min', w.focused && 'cur'],
    role: 'listitem',
    tabindex: 0,
    'data-app': w.id,
    'aria-label': name,
    style: { '--i': i },
  },
  h('div', { class: 'rc-card-head' },
    h('button', { class: 'rc-card-app', title: t('common.more'), 'aria-label': `${name}, ${t('common.more')}`, onClick: (e) => { e.stopPropagation(); cardMenu(w, e.currentTarget); } },
      appIconEl(w.app, 26), h('span', null, name)),
    h('button', { class: 'rc-x', title: t('common.close'), 'aria-label': `${t('common.close')} ${name}`, html: icon('close', 16), onClick: (e) => { e.stopPropagation(); killApp(w.id, card); } })),
  shot);
  card._syncScroll = () => {
    const from = w.win.querySelectorAll('.app-scroll'), to = copy.querySelectorAll('.app-scroll');
    to.forEach((n, k) => (n.scrollTop = from[k]?.scrollTop || 0));
  };
  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    activateApp(w.id);
  });
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cardMenu(w, e);
  });
  swipeToClose(card, () => killApp(w.id, card));
  return card;
}

/** A still copy of the window for its card: same DOM, nothing focusable, canvases turned into pictures. */
function snapshot(win) {
  const copy = win.cloneNode(true);
  const canv = win.querySelectorAll('canvas'), canvCopy = copy.querySelectorAll('canvas');
  canvCopy.forEach((c, k) => {
    const src = canv[k];
    let url = '';
    try {
      url = src.width && src.height ? src.toDataURL() : '';
    } catch {}
    const img = h('img', { alt: '', class: c.getAttribute('class') || null, style: c.getAttribute('style') || null, src: url || null });
    img.style.width = src.clientWidth + 'px';
    img.style.height = src.clientHeight + 'px';
    c.replaceWith(img);
  });
  copy.querySelectorAll('audio, video, iframe, script, .app-rz').forEach((n) => n.remove());
  copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  copy.querySelectorAll('[autofocus]').forEach((n) => n.removeAttribute('autofocus'));
  const keep = [...win.classList].filter((c) => /^size-/.test(c) || c === 'max' || c === 'split');
  copy.className = ['rc-clone', ...keep].join(' ');
  for (const a of ['style', 'role', 'aria-label', 'tabindex', 'data-app']) copy.removeAttribute(a);
  copy.style.width = win.offsetWidth + 'px';
  copy.style.height = win.offsetHeight + 'px';
  if (win.style.background) copy.style.background = win.style.background; // e.g. Weather's sky
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  return copy;
}

function activateApp(id) {
  closeRecents();
  openApp(id);
}

function killApp(id, card) {
  gone(card, () => closeApp(false, id));
}

function gone(card, fn) {
  card.classList.add('gone');
  if (document.documentElement.dataset.motion === 'reduce') return fn();
  setTimeout(fn, 200);
}

function cardMenu(w, at) {
  menu(at, [
    { label: t('recents.splitView'), icon: 'winSplit', onClick: () => { closeRecents(); splitApp(w.id); } },
    { label: t('recents.popupView'), icon: 'winPopup', onClick: () => { closeRecents(); popupApp(w.id); } },
    '-',
    { label: t('common.close'), icon: 'close', danger: true, onClick: () => closeApp(false, w.id) },
  ]);
}

/** Flick a card up to close it (One UI); a horizontal drag is left to the row's scrolling. */
function swipeToClose(card, kill) {
  card.style.touchAction = 'pan-x';
  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const sx = e.clientX, sy = e.clientY;
    let dy = 0, moved = false, off = false;
    const mv = (ev) => {
      if (off) return;
      const ddy = ev.clientY - sy;
      if (!moved) {
        if (Math.abs(ddy) < 8) return;
        if (Math.abs(ev.clientX - sx) > Math.abs(ddy)) return void (off = true);
        moved = true;
        card.classList.add('dragging');
      }
      dy = Math.min(0, ddy);
      card.style.transform = `translateY(${dy}px)`;
      card.style.opacity = String(clamp(1 + dy / 320, 0.2, 1));
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      card.classList.remove('dragging');
      if (!moved) return;
      card.addEventListener('click', (ev) => ev.stopPropagation(), { once: true, capture: true });
      if (dy < -100) kill();
      else {
        card.style.transform = '';
        card.style.opacity = '';
      }
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

// ——— Chrome tabs, Recently closed, Workspaces ———
const ownPage = (url = '') => /^chrome:\/\/newtab/.test(url) || (isExt && url.startsWith(location.origin + '/newtab.html'));
const tabsApi = () => isExt && !!C?.tabs;

async function renderTabs() {
  const seq = ++renderSeq;
  const tabsOk = tabsApi() && (await has('tabs'));
  let tabs = [], me = null;
  if (tabsOk) {
    me = await C.tabs.getCurrent().catch(() => null);
    tabs = (await C.tabs.query({}).catch(() => [])).filter((tb) => tb.id !== me?.id && !ownPage(tb.url || tb.pendingUrl));
    tabs.sort((a, b) => (a.windowId === me?.windowId ? 0 : 1) - (b.windowId === me?.windowId ? 0 : 1) || a.windowId - b.windowId || a.index - b.index);
  }
  const sessOk = tabsOk && !!C?.sessions && (await has('sessions'));
  const closed = sessOk ? (await C.sessions.getRecentlyClosed({ maxResults: 25 }).catch(() => [])).filter((s) => (s.tab && /^https?:/.test(s.tab.url || '')) || s.window?.tabs?.length).slice(0, 6) : [];
  if (seq !== renderSeq || !root) return;

  tabsBox.replaceChildren(
    h('div', { class: 'rc-sec' }, h('span', { html: icon('tab', 18) }), t('recents.tabs'), tabsOk && tabs.length ? h('small', null, String(tabs.length)) : null),
    !tabsOk
      ? h('div', { class: 'rc-ask' },
        h('span', { class: 'rc-ask-ico', html: icon('tab', 26) }),
        h('p', null, t('recents.tabsAsk')),
        btn(t('recents.showTabs'), async () => {
          if (await ensure('tabs')) renderTabs();
          else toast(t('recents.denied'));
        }, 'primary'))
      : tabs.length
        ? h('div', { class: 'rc-row rc-tabs', role: 'list' }, tabs.slice(0, 60).map((tb) => tabCard(tb)))
        : h('div', { class: 'rc-none' }, t('recents.noTabs')));

  const ws = store.get('workspaces') || [];
  bottomBox.replaceChildren(
    h('section', { class: 'rc-panel rc-ws-panel' },
      h('div', { class: 'rc-panel-title' }, h('span', { html: icon('workspace', 18) }), t('recents.workspaces')),
      ws.length ? null : h('p', { class: 'rc-panel-note' }, t('recents.wsEmpty')),
      h('div', { class: 'rc-ws-list' },
        ws.map((w) => wsChip(w)),
        h('button', { class: 'rc-ws add', onClick: async () => { await saveWorkspace(); if (root) renderTabs(); } }, h('span', { html: icon('plus', 16) }), t('recents.saveWs')))),
    h('section', { class: 'rc-panel rc-closed-panel' },
      h('div', { class: 'rc-panel-title' }, h('span', { html: icon('history', 18) }), t('recents.closed')),
      !tabsOk
        ? h('p', { class: 'rc-panel-note' }, t('recents.tabsFirst'))
        : !sessOk
          ? h('button', { class: 'rc-ws add', onClick: async () => { if (await ensure('sessions')) renderTabs(); else toast(t('recents.denied')); } }, h('span', { html: icon('history', 16) }), t('recents.showClosed'))
          : closed.length
            ? h('div', { class: 'rc-closed' }, closed.map((s) => closedRow(s)))
            : h('p', { class: 'rc-panel-note' }, t('recents.noClosed'))));
}

function tabCard(tb) {
  const host = hostname(tb.url || '') || tb.url || '';
  const card = h('div', { class: ['rc-tab', tb.active && 'active'], role: 'listitem', tabindex: 0, 'data-tab': tb.id, title: tb.title || host },
    h('div', { class: 'rc-tab-top' },
      h('img', { src: faviconUrl(tb.url || '', 32), alt: '' }),
      h('span', { class: 'rc-tab-host' }, host),
      tb.audible ? h('span', { class: 'rc-tab-audio', html: icon(tb.mutedInfo?.muted ? 'mute' : 'volume', 14) }) : null,
      h('button', { class: 'rc-x', title: t('recents.closeTab'), 'aria-label': t('recents.closeTab'), html: icon('close', 14), onClick: (e) => { e.stopPropagation(); killTab(tb.id, card); } })),
    h('div', { class: 'rc-tab-title' }, tb.title || host));
  card.addEventListener('click', (e) => {
    if (!e.target.closest('button')) switchTab(tb);
  });
  swipeToClose(card, () => killTab(tb.id, card));
  return card;
}

function switchTab(tb) {
  closeRecents();
  C.tabs.update(tb.id, { active: true }).catch(() => {});
  C.windows?.update(tb.windowId, { focused: true }).catch(() => {});
}

function killTab(id, card) {
  gone(card, () => C.tabs.remove(id).catch(() => {}).then(() => root && renderTabs()));
}

function closedRow(s) {
  const tb = s.tab;
  const title = tb ? tb.title || hostname(tb.url) : t('recents.window', { n: s.window.tabs.length });
  const sid = (tb || s.window).sessionId;
  return h('button', {
    class: 'rc-closed-row', 'data-sid': sid, title: tb?.url || '',
    onClick: () => {
      closeRecents();
      C.sessions.restore(sid).catch(() => {});
    },
  }, tb ? h('img', { src: faviconUrl(tb.url, 32), alt: '' }) : h('span', { class: 'rc-closed-win', html: icon('tab', 18) }),
  h('span', { class: 'rc-closed-t' }, title),
  tb ? h('small', null, hostname(tb.url)) : null);
}

function wsChip(w) {
  const el = h('button', { class: 'rc-ws', 'data-ws': w.id, title: w.tabs.map((x) => x.title || x.url).slice(0, 12).join('\n'), style: { '--c': SWATCH[w.color] || SWATCH.blue } },
    h('i'), h('span', { class: 'rc-ws-name' }, w.name), h('small', null, String(w.tabs.length)));
  el.addEventListener('click', () => {
    if (el._long) return void (el._long = false);
    closeRecents();
    openWorkspace(w.id);
  });
  const more = (at) => menu(at, [
    { label: t('common.open'), icon: 'external', onClick: () => { closeRecents(); openWorkspace(w.id); } },
    { label: t('common.rename'), icon: 'edit', onClick: () => renameWorkspace(w.id) },
    { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteWorkspace(w.id) },
  ]);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    more(e);
  });
  onLongPress(el, () => {
    el._long = true;
    more(el);
  });
  return el;
}

/** Saves the websites open in this Chrome window as a named workspace. */
export async function saveWorkspace() {
  if (!tabsApi() || !(await ensure('tabs'))) return toast(t('recents.denied'));
  const me = await C.tabs.getCurrent().catch(() => null);
  const tabs = (await C.tabs.query({ currentWindow: true })).filter((tb) => tb.id !== me?.id && /^https?:/.test(tb.url || ''));
  if (!tabs.length) return toast(t('recents.noSites'));
  const input = h('input', { class: 'ou-input', placeholder: t('recents.wsPh'), maxlength: 40 });
  const name = await dialog({
    title: t('recents.newWs'),
    message: t('recents.wsMsg', { n: tabs.length }),
    content: h('div', { class: 'ou-dialog-body' }, input),
    actions: [
      { label: t('common.cancel'), value: null },
      { label: t('common.save'), value: () => input.value, primary: true, validate: () => !!input.value.trim() },
    ],
  });
  if (!name?.trim()) return;
  const list = store.get('workspaces') || [];
  store.set('workspaces', [...list, { id: uid(), name: name.trim(), color: COLORS[list.length % COLORS.length], tabs: tabs.map((tb) => ({ url: tb.url, title: tb.title || '' })), at: Date.now() }]);
  toast(t('recents.wsSaved'));
}

/** Opens every website of a workspace in a new Chrome tab group named after it. Call from a click (permissions). */
export async function openWorkspace(id) {
  const w = (store.get('workspaces') || []).find((x) => x.id === id || x.name.toLowerCase() === String(id).toLowerCase());
  if (!w || !tabsApi() || !w.tabs.length) return false;
  // naming and colouring the group takes the optional "tab groups" permission (asked the first time, from this click)
  const named = await ensure('tabGroups');
  const made = [];
  for (const [i, tb] of w.tabs.entries()) made.push(await C.tabs.create({ url: tb.url, active: i === 0 }));
  try {
    const gid = await C.tabs.group({ tabIds: made.map((x) => x.id) });
    if (named && C.tabGroups) await C.tabGroups.update(gid, { title: w.name, color: w.color || 'blue' });
  } catch (e) {
    console.warn('tab group', e);
  }
  store.update('workspaces', (l) => (l || []).map((x) => (x.id === w.id ? { ...x, used: Date.now() } : x)));
  return true;
}

async function renameWorkspace(id) {
  const w = (store.get('workspaces') || []).find((x) => x.id === id);
  if (!w) return;
  const v = await prompt(t('recents.wsRename'), { value: w.name, placeholder: t('recents.wsPh') });
  if (!v?.trim()) return;
  store.update('workspaces', (l) => (l || []).map((x) => (x.id === id ? { ...x, name: v.trim() } : x)));
  if (root) renderTabs();
}

async function deleteWorkspace(id) {
  const w = (store.get('workspaces') || []).find((x) => x.id === id);
  if (!w || !(await confirm(t('recents.wsDelete'), t('recents.wsDeleteMsg', { name: w.name }), { okLabel: t('common.delete'), danger: true }))) return;
  store.update('workspaces', (l) => (l || []).filter((x) => x.id !== id));
  if (root) renderTabs();
}

// ——— keys: ←/→ choose a card, Enter opens, Delete closes, Esc goes back ———
function onKey(e) {
  if (root && isLocked()) return closeRecents(); // the Lock screen needs the keys
  if (!root || document.querySelector('.ou-dialog-scrim, .ou-menu-scrim')) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return; // shell shortcuts (Alt+R closes) still work
  const cards = [...root.querySelectorAll('.rc-card, .rc-tab')];
  const cur = document.activeElement?.closest?.('.rc-card, .rc-tab');
  const i = cards.indexOf(cur);
  const stop = () => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  if (e.key === 'Escape') {
    stop();
    closeRecents();
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    stop();
    const d = (e.key === 'ArrowRight' ? 1 : -1) * (isRtl() ? -1 : 1);
    const next = cards[clamp(i < 0 ? 0 : i + d, 0, cards.length - 1)];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } else if ((e.key === 'Enter' || e.key === ' ') && cur && e.target === cur) {
    stop();
    cur.click();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && cur) {
    stop();
    cur.querySelector('.rc-x')?.click();
    setTimeout(() => (cards[i + 1] || cards[i - 1])?.focus?.(), 260);
  } else if (!e.target.closest?.('input, textarea')) e.stopPropagation(); // keys don't reach the apps behind
}

// ——— the gesture bar: One UI's navigation hint at the bottom of the screen ———
export function initRecents() {
  const bar = h('button', { class: 'nav-hint', title: t('recents.hint'), 'aria-label': t('recents.title') }, h('span'));
  let sy = null, dy = 0;
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    sy = e.clientY;
    dy = 0;
    bar.setPointerCapture?.(e.pointerId);
  });
  bar.addEventListener('pointermove', (e) => {
    if (sy == null) return;
    dy = Math.min(0, e.clientY - sy);
    bar.style.setProperty('--pull', dy + 'px');
  });
  bar.addEventListener('pointerup', () => {
    if (sy == null) return;
    sy = null;
    bar.style.removeProperty('--pull');
    // swipe up and let go, or a click: Recents
    if (dy < -24) openRecents();
    else toggleRecents();
  });
  bar.addEventListener('click', (e) => {
    if (e.detail === 0) toggleRecents(); // keyboard
  });
  document.body.appendChild(bar);
}

// ——— extension points ———
registerApp({
  id: 'recents',
  name: 'recents.title',
  hidden: true,
  icon: { bg: 'linear-gradient(150deg, #6b7280, #374151)', glyph: '<path d="M7 6.5v11M12 6.5v11M17 6.5v11"/>' },
  launch: () => openRecents(),
});

registerTile({ id: 'recents', icon: 'recents', order: 5, label: () => t('recents.title'), on: () => false, toggle: () => (openRecents(), true) });

const RECENTS_WORDS = ['recents', 'recent apps', 'open apps', 'open windows', 'windows', 'app switcher', 'multi window', 'my tabs', 'chrome tabs', 'التطبيقات الحديثة', 'الحديثة', 'النوافذ', 'التبويبات'];
const CLOSE_WORDS = ['close all', 'close all windows', 'close windows', 'إغلاق الكل', 'إغلاق النوافذ'];
const WS_RE = /^(?:workspaces?|مساحات العمل|مساحة العمل|مساحة عمل)\s*(.*)$/;
registerCommand('recents', (q, lower, done) => {
  const s = lower.trim();
  if (s.length < 4) return [];
  const out = [];
  const go = () => {
    done?.();
    openRecents();
  };
  if (RECENTS_WORDS.some((w) => w.startsWith(s))) out.push({ icon: 'recents', title: t('recents.title'), sub: t('recents.cmdSub'), run: go });
  if (openWindows().length && CLOSE_WORDS.some((w) => w.startsWith(s))) out.push({ icon: 'close', title: t('recents.closeAllCmd'), sub: t('recents.title'), run: () => { done?.(); closeAllApps(); } });
  const m = s.match(WS_RE);
  const rest = (m ? m[1] : s).trim();
  for (const w of store.get('workspaces') || []) {
    const n = w.name.toLowerCase();
    if (m ? !rest || n.includes(rest) : n.startsWith(rest)) {
      out.push({ icon: 'workspace', title: t('recents.openWs', { name: w.name }), sub: t('recents.wsSub', { n: w.tabs.length }), run: () => { done?.(); openWorkspace(w.id); } });
    }
  }
  if (m && !rest) out.push({ icon: 'workspace', title: t('recents.workspaces'), sub: t('recents.title'), run: go });
  return out.slice(0, 6);
});

addStrings({
  en: {
    'recents.title': 'Recents',
    'recents.hint': 'Recents (Alt+R)',
    'recents.noApps': 'No recent apps',
    'recents.closeAll': 'Close all',
    'recents.splitView': 'Open in split screen view',
    'recents.popupView': 'Open in pop-up view',
    'recents.tabs': 'Chrome tabs',
    'recents.tabsAsk': 'See and switch between your open Chrome tabs here.',
    'recents.showTabs': 'Show my tabs',
    'recents.noTabs': 'No other tabs are open.',
    'recents.closeTab': 'Close tab',
    'recents.closed': 'Recently closed',
    'recents.showClosed': 'Show recently closed tabs',
    'recents.noClosed': 'Nothing closed recently.',
    'recents.tabsFirst': 'Show your tabs first to see the ones you closed.',
    'recents.window': 'Window · {n} tabs',
    'recents.workspaces': 'Workspaces',
    'recents.wsEmpty': 'Save the websites open in this window and reopen them later as a tab group.',
    'recents.saveWs': 'Save tabs as workspace',
    'recents.newWs': 'New workspace',
    'recents.wsMsg': 'Saves the {n} websites open in this window.',
    'recents.wsPh': 'Work, Study, Weekend…',
    'recents.wsSaved': 'Workspace saved',
    'recents.wsRename': 'Rename workspace',
    'recents.wsDelete': 'Delete workspace?',
    'recents.wsDeleteMsg': '“{name}” will be removed. Open tabs stay open.',
    'recents.openWs': 'Open workspace “{name}”',
    'recents.wsSub': 'Workspace · {n} websites',
    'recents.noSites': 'Open some websites first',
    'recents.denied': 'Permission not granted',
    'recents.cmdSub': 'Open apps, Chrome tabs and workspaces',
    'recents.closeAllCmd': 'Close all windows',
  },
  ar: {
    'recents.title': 'التطبيقات الحديثة',
    'recents.hint': 'التطبيقات الحديثة (Alt+R)',
    'recents.noApps': 'لا توجد تطبيقات حديثة',
    'recents.closeAll': 'إغلاق الكل',
    'recents.splitView': 'فتح في عرض الشاشة المقسمة',
    'recents.popupView': 'فتح في العرض المنبثق',
    'recents.tabs': 'تبويبات Chrome',
    'recents.tabsAsk': 'اعرض تبويبات Chrome المفتوحة وانتقل بينها من هنا.',
    'recents.showTabs': 'إظهار تبويباتي',
    'recents.noTabs': 'لا توجد تبويبات أخرى مفتوحة.',
    'recents.closeTab': 'إغلاق التبويب',
    'recents.closed': 'المغلقة مؤخرًا',
    'recents.showClosed': 'إظهار التبويبات المغلقة مؤخرًا',
    'recents.noClosed': 'لم يتم إغلاق أي شيء مؤخرًا.',
    'recents.tabsFirst': 'اعرض تبويباتك أولًا لرؤية التي أغلقتها.',
    'recents.window': 'نافذة · عدد التبويبات {n}',
    'recents.workspaces': 'مساحات العمل',
    'recents.wsEmpty': 'احفظ مواقع الويب المفتوحة في هذه النافذة وأعد فتحها لاحقًا كمجموعة تبويبات.',
    'recents.saveWs': 'حفظ التبويبات كمساحة عمل',
    'recents.newWs': 'مساحة عمل جديدة',
    'recents.wsMsg': 'يحفظ مواقع الويب المفتوحة في هذه النافذة وعددها {n}.',
    'recents.wsPh': 'العمل، الدراسة، عطلة نهاية الأسبوع…',
    'recents.wsSaved': 'تم حفظ مساحة العمل',
    'recents.wsRename': 'إعادة تسمية مساحة العمل',
    'recents.wsDelete': 'حذف مساحة العمل؟',
    'recents.wsDeleteMsg': 'ستتم إزالة "{name}". تبقى التبويبات المفتوحة كما هي.',
    'recents.openWs': 'فتح مساحة العمل "{name}"',
    'recents.wsSub': 'مساحة عمل · عدد المواقع {n}',
    'recents.noSites': 'افتح بعض مواقع الويب أولًا',
    'recents.denied': 'لم يتم منح الإذن',
    'recents.cmdSub': 'التطبيقات المفتوحة وتبويبات Chrome ومساحات العمل',
    'recents.closeAllCmd': 'إغلاق كل النوافذ',
  },
});
