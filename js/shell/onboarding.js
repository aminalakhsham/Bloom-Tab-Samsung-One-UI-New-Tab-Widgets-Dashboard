// Welcome tour in the style of One UI's setup wizard: a big friendly title, one choice per page, pill buttons at the
// bottom and progress dots. main.js calls startTour() right after the theme is applied and before the shell is built;
// while the tour is up, html.onb-pending (css/onboarding.css) hides the Lock and Home screens, so neither flashes
// before it. Picking a language reloads the page (main.js reloads on a `lang` change) straight back into the tour:
// sessionStorage remembers the page and settings.onboarded === false says the tour is still running.
import { h, $$, uid, hostname, siteName, faviconUrl, isExt } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, addStrings, tr, lang, LANGS, fmtDate } from '../core/i18n.js';
import { store, setting, setSetting } from '../core/store.js';
import { ensure } from '../core/perm.js';
import { toast, switchRow, list } from '../core/ui.js';
import { PRESETS, paintPreset, presetById } from './wallpaper.js';
import { ENGINES, ASSISTANTS } from './finder.js';
import { CLOCK_FONTS, CLOCK_STYLES, clockMarkup } from './lock.js';

const STEPS = ['welcome', 'language', 'theme', 'wallpaper', 'home', 'search', 'permissions', 'lock', 'done'];
const STEP_KEY = 'bt.onb.step';
// the progress dots count the choice pages, not the welcome and closing ones
const DOTS = STEPS.slice(1, -1);

let root = null;
export const tourOpen = () => !!root;
const manifestVersion = () => (isExt ? chrome.runtime.getManifest().version : '');

/**
 * Decides whether this tab shows the welcome tour and, if so, puts it on screen. Called once by main.js before the
 * shell is built. Returns true while the tour shows.
 */
export function startTour() {
  const s = store.get('settings');
  if (s.onboarded === true || root) return !!root;
  // automated test runs share a profile that never sets `onboarded`: the tour stays away unless a test asks for it
  if (navigator.webdriver && !localStorage.getItem('bt.test.tour')) return false;
  // people who used Bloom Tab before the tour existed already have a Home screen: they count as onboarded
  // (and get What's new instead)
  if (s.onboarded == null && Array.isArray(store.get('home'))) {
    setSetting('onboarded', true);
    return false;
  }
  // false = in progress, so a reload (the language switch) or a second tab comes back to the tour
  if (s.onboarded !== false) setSetting('onboarded', false);
  document.documentElement.classList.add('onb-pending');
  mount();
  return true;
}

function mount() {
  let step = Math.max(0, STEPS.indexOf(sessionStorage.getItem(STEP_KEY)));
  sessionStorage.removeItem(STEP_KEY);
  const state = { home: null, top: null };
  let page = null, bloomStop = null;

  const stage = h('div', { class: 'onb-stage' });
  const dots = h('div', { class: 'onb-dots', 'aria-hidden': 'true' }, DOTS.map(() => h('i')));
  const back = h('button', { class: 'onb-back', onClick: () => go(step - 1, true) }, t('onb.back'));
  const next = h('button', { class: 'onb-next', onClick: () => advance() });
  const bloom = h('canvas', { class: 'onb-bloom', width: 192, height: 120, 'aria-hidden': 'true' });
  root = h('div', { class: 'onb', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('onb.aria'), tabindex: '-1' },
    bloom, stage, h('div', { class: 'onb-bar' }, back, dots, next));
  document.body.appendChild(root);

  // Keys stay inside the tour: the shell's own shortcuts (type to search, arrows, Esc…) must not act behind it.
  // Keys aimed at something outside (the Lock screen takes focus when the tab starts locked) are swallowed here.
  const guard = (e) => {
    if (!root || root.contains(e.target)) return;
    e.stopImmediatePropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      next.click();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      root.focus();
    }
  };
  addEventListener('keydown', guard, true);
  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.target.closest('button, input, a, label')) {
      e.preventDefault();
      next.click();
    }
  });

  // The welcome page blooms like the default wallpaper (a tiny canvas scaled up is a free blur).
  function startBloom() {
    bloomStop?.();
    const p = presetById(setting('wallpaper')?.id || 'bloom');
    const t0 = performance.now();
    let raf = 0, last = 0;
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 1000 / 24) return;
      last = now;
      paintPreset(bloom, p, 8 + (now - t0) / 1000);
    };
    paintPreset(bloom, p, 8);
    if (!setting('reduceMotion')) raf = requestAnimationFrame(draw);
    bloomStop = () => cancelAnimationFrame(raf);
  }

  function go(i, backwards = false) {
    if (i < 0 || i >= STEPS.length) return;
    step = i;
    const id = STEPS[step];
    page?.cleanup?.();
    page = PAGES[id](state, () => render(false));
    root.dataset.step = id;
    if (id === 'welcome') startBloom();
    else bloomStop?.();
    render(true, backwards);
  }

  function render(fresh, backwards) {
    const id = STEPS[step];
    if (fresh) {
      page.el.classList.add('onb-page', 'onb-p-' + id);
      if (backwards) page.el.classList.add('from-back');
      stage.replaceChildren(page.el);
      stage.scrollTop = 0;
    }
    back.hidden = step === 0 || id === 'done';
    const d = DOTS.indexOf(id);
    dots.hidden = d < 0;
    [...dots.children].forEach((x, i) => x.classList.toggle('on', i === d));
    next.textContent = page.next?.() || t('onb.next');
    // keyboard focus stays in the tour (Enter = Next) without drawing a focus ring on the button
    if (fresh) setTimeout(() => root && !root.contains(document.activeElement) && root.focus({ preventScroll: true }), 30);
  }

  async function advance() {
    if (next.disabled) return;
    next.disabled = true;
    try {
      if (page.onNext) await page.onNext();
    } catch (e) {
      console.error('tour', e);
    }
    next.disabled = false;
    if (STEPS[step] === 'done') return finish();
    go(step + 1);
  }

  function finish() {
    const v = manifestVersion();
    // a new user saw everything new in the tour: What's new is for people updating from an older version
    store.update('settings', (s) => ({ ...s, onboarded: true, seenVersion: v }));
    removeEventListener('keydown', guard, true);
    bloomStop?.();
    page?.cleanup?.();
    const el = root;
    root = null;
    import('./lock.js').then((m) => m.isLocked() && m.unlock());
    document.documentElement.classList.remove('onb-pending');
    el.classList.add('out');
    setTimeout(() => el.remove(), setting('reduceMotion') ? 0 : 420);
  }

  go(step);
}

// ——— pages ———
// Each returns { el, next?() -> button label, onNext?() (may be async), cleanup?() }. `refresh` redraws the bar.

const head = (ic, color, title, sub) => [
  h('div', { class: 'onb-ico', style: { '--c': color }, html: icon(ic, 28) }),
  h('h1', { class: 'onb-title' }, title),
  sub ? h('p', { class: 'onb-sub' }, sub) : null,
];

/** One UI radio indicator (checked = thick accent ring). */
const radio = () => h('span', { class: 'onb-radio', 'aria-hidden': 'true' });

function pick(container, sel, el) {
  $$(sel, container).forEach((x) => {
    x.classList.toggle('on', x === el);
    x.setAttribute('aria-checked', String(x === el));
  });
}

const PAGES = {
  welcome() {
    return {
      el: h('div', null,
        h('div', { class: 'onb-hello' },
          h('div', { class: 'onb-mark', html: '<svg viewBox="0 0 24 24" width="44" height="44"><path d="M12 3c1.4 3.8 3.4 5.8 7.2 7.2C15.4 11.6 13.4 13.6 12 17.4 10.6 13.6 8.6 11.6 4.8 10.2 8.6 8.8 10.6 6.8 12 3Z" fill="#fff"/><path d="M18.5 15.5c.5 1.6 1.2 2.3 2.8 2.8-1.6.5-2.3 1.2-2.8 2.8-.5-1.6-1.2-2.3-2.8-2.8 1.6-.5 2.3-1.2 2.8-2.8Z" fill="#fff"/></svg>' }),
          h('h1', { class: 'onb-welcome-title' }, t('onb.welcome')),
          h('p', { class: 'onb-sub' }, t('onb.welcomeSub')))),
      next: () => t('onb.getStarted'),
    };
  },

  language() {
    const cur = lang();
    const box = h('div', { class: 'onb-list', role: 'radiogroup', 'aria-label': t('onb.langTitle') },
      LANGS.map((l) => {
        const local = t('onb.lang.' + l.id);
        const b = h('button', { class: ['onb-opt', l.id === cur && 'on'], role: 'radio', 'aria-checked': String(l.id === cur), dataset: { lang: l.id }, lang: l.id, onClick: () => choose(l.id, b) },
          h('span', { class: 'onb-opt-text' }, h('b', null, l.name), local !== l.name ? h('span', null, local) : null),
          radio());
        return b;
      }));
    function choose(id, b) {
      pick(box, '.onb-opt', b);
      if (id === lang()) return;
      // main.js reloads every tab when the language changes; this one comes back to this page of the tour
      sessionStorage.setItem(STEP_KEY, 'language');
      setSetting('lang', id);
    }
    return { el: h('div', null, ...head('globe', '#3e7bff', t('onb.langTitle'), t('onb.langSub')), box) };
  },

  theme() {
    const opts = [['light', 'onb.light', ''], ['dark', 'onb.dark', ''], ['auto', 'onb.auto', 'onb.autoSub']];
    const box = h('div', { class: 'onb-themes', role: 'radiogroup', 'aria-label': t('onb.themeTitle') },
      opts.map(([v, label, sub]) => {
        const on = setting('theme') === v;
        const b = h('button', { class: ['onb-theme', on && 'on'], role: 'radio', 'aria-checked': String(on), dataset: { theme: v }, onClick: () => { setSetting('theme', v); pick(box, '.onb-theme', b); } },
          mock(v),
          h('span', { class: 'onb-theme-label' }, h('b', null, t(label)), sub ? h('span', null, t(sub)) : null),
          radio());
        return b;
      }));
    return { el: h('div', null, ...head('sun', '#ffa21f', t('onb.themeTitle'), t('onb.themeSub')), box) };
  },

  wallpaper() {
    const cur = setting('wallpaper');
    const box = h('div', { class: 'onb-walls', role: 'radiogroup', 'aria-label': t('onb.wallTitle') },
      PRESETS.map((p, i) => {
        const on = cur?.type === 'preset' && cur.id === p.id;
        const c = h('canvas', { width: 160, height: 100 });
        paintPreset(c, presetById(p.id), 3 + i); // dual presets keep their colours under .light/.dark
        const b = h('button', { class: ['onb-wall', on && 'on'], role: 'radio', 'aria-checked': String(on), 'aria-label': t('onb.wallN', { n: i + 1 }), dataset: { wp: p.id }, onClick: () => { setSetting('wallpaper', { type: 'preset', id: p.id }); pick(box, '.onb-wall', b); } },
          c, h('span', { class: 'onb-wall-check', html: icon('check', 16) }));
        return b;
      }));
    return { el: h('div', null, ...head('image', '#8e6bff', t('onb.wallTitle'), t('onb.wallSub')), box) };
  },

  home(state) {
    const icons = h('div', { class: 'onb-fan' });
    const mineSub = h('span', null, t('onb.homeMineSub'));
    const mine = h('button', { class: 'onb-choice', role: 'radio', dataset: { home: 'mine' }, onClick: () => set('mine') },
      h('span', { class: 'onb-choice-art' }, icons),
      h('span', { class: 'onb-opt-text' }, h('b', null, t('onb.homeMine')), mineSub), radio());
    const starter = h('button', { class: 'onb-choice', role: 'radio', dataset: { home: 'starter' }, onClick: () => set('starter') },
      h('span', { class: 'onb-choice-art' }, h('span', { class: 'onb-starter' }, h('i', { class: 'w' }), ...Array.from({ length: 6 }, () => h('i')))),
      h('span', { class: 'onb-opt-text' }, h('b', null, t('onb.homeStarter')), h('span', null, t('onb.homeStarterSub'))), radio());
    const box = h('div', { class: 'onb-choices', role: 'radiogroup', 'aria-label': t('onb.homeTitle') }, mine, starter);
    function set(v) {
      if (v === 'mine' && !state.top?.length) return;
      state.home = v;
      pick(box, '.onb-choice', v === 'mine' ? mine : starter);
    }
    function show() {
      const top = state.top || [];
      icons.replaceChildren(...top.slice(0, 5).map((s, i) => h('span', { class: 'onb-fav', style: { '--i': i } }, h('img', { src: faviconUrl(s.url, 64), alt: '' }))));
      if (!top.length) {
        mine.disabled = true;
        mineSub.textContent = t('onb.homeMineNone');
      }
      set(state.home || (top.length ? 'mine' : 'starter'));
    }
    if (state.top) show();
    else topSites().then((top) => { state.top = top; show(); });
    return {
      el: h('div', null, ...head('home', '#22b07d', t('onb.homeTitle'), t('onb.homeSub')), box),
      onNext: () => state.home === 'mine' && addMySites(state.top),
    };
  },

  search() {
    const chips = (entries, key) => {
      const box = h('div', { class: 'ou-chips onb-chips', role: 'radiogroup' });
      const draw = () => box.replaceChildren(...entries.map(([id, e]) => {
        const on = setting(key) === id;
        return h('button', { class: ['ou-chip', on && 'active'], role: 'radio', 'aria-checked': String(on), dataset: { [key]: id }, onClick: () => { setSetting(key, id); draw(); } },
          e.url ? h('img', { class: 'onb-chip-fav', src: faviconUrl(e.url.replace(/[?#].*$/, ''), 32), alt: '' }) : h('span', { html: icon('globe', 18) }),
          tr(e.name));
      }));
      draw();
      return box;
    };
    return {
      el: h('div', null, ...head('search', '#ff6a3d', t('onb.searchTitle'), t('onb.searchSub')),
        h('div', { class: 'onb-label' }, t('onb.engine')), chips(Object.entries(ENGINES), 'searchEngine'),
        h('div', { class: 'onb-label' }, t('onb.ai')), chips(Object.entries(ASSISTANTS), 'aiAssistant'),
        h('p', { class: 'onb-fine' }, t('onb.aiSub'))),
    };
  },

  permissions(state, refresh) {
    const permRow = (key, permission, ic, color) => {
      const r = switchRow({
        icon: ic,
        iconBg: color,
        title: t('onb.' + permission),
        sub: t('onb.' + permission + 'Sub'),
        checked: !!setting(key),
        onChange: async (on) => {
          // Chrome's prompt needs this click: ensure() asks right away
          if (on && !(await ensure(permission))) {
            r.querySelector('input').checked = false;
            toast(t('onb.permDenied'));
            return;
          }
          setSetting(key, on);
          refresh();
        },
      });
      r.dataset.perm = permission;
      return r;
    };
    return {
      el: h('div', null, ...head('bookmark', '#14a88f', t('onb.permTitle'), t('onb.permSub')),
        list(permRow('finderBookmarks', 'bookmarks', 'bookmark', '#3e7bff'), permRow('finderHistory', 'history', 'history', '#ff9f1c'))),
      next: () => (setting('finderBookmarks') || setting('finderHistory') ? t('onb.next') : t('onb.skip')),
    };
  },

  lock() {
    const sample = new Date(2026, 0, 1, 10, 8);
    const styles = h('div', { class: 'onb-locks', role: 'radiogroup', 'aria-label': t('onb.lockTitle') });
    const fonts = h('div', { class: 'ou-chips onb-chips', role: 'radiogroup', 'aria-label': t('onb.font') });
    const draw = () => {
      const s = store.get('settings');
      const wp = s.wallpaper?.type === 'preset' ? presetById(s.wallpaper.id) : presetById('bloom');
      styles.replaceChildren(...CLOCK_STYLES.map((st) => {
        const c = h('canvas', { width: 90, height: 160 });
        paintPreset(c, wp, 5);
        const on = s.clockStyle === st;
        return h('button', { class: ['onb-lock', on && 'on'], role: 'radio', 'aria-checked': String(on), dataset: { clock: st }, onClick: () => { setSetting('clockStyle', st); draw(); } },
          h('span', { class: ['onb-lock-prev', wp.tone === 'light' && 'light'] }, c,
            h('span', { class: 'onb-lock-date' }, fmtDate(sample, { weekday: 'short', month: 'short', day: 'numeric' })),
            h('span', { class: ['set-lock-clock', 'c-' + st], html: clockMarkup(sample, st), style: { fontFamily: CLOCK_FONTS[s.clockFont] || CLOCK_FONTS.outfit, fontWeight: st === 'thin' ? 100 : s.clockWeight } })),
          h('span', { class: 'onb-lock-name' }, t('onb.clock.' + st)));
      }));
      fonts.replaceChildren(...Object.keys(CLOCK_FONTS).map((f) => {
        const on = s.clockFont === f;
        return h('button', { class: ['ou-chip', on && 'active'], role: 'radio', 'aria-checked': String(on), dataset: { font: f }, style: { fontFamily: CLOCK_FONTS[f] }, onClick: () => { setSetting('clockFont', f); draw(); } }, t('onb.font.' + f));
      }));
    };
    draw();
    return {
      el: h('div', null, ...head('lock', '#14a88f', t('onb.lockTitle'), t('onb.lockSub')), styles, h('div', { class: 'onb-label' }, t('onb.font')), fonts),
    };
  },

  done() {
    const tip = (ic, color, title, sub) => h('div', { class: 'ou-row' },
      h('span', { class: 'ou-row-ico onb-tip-ico', style: { background: color }, html: icon(ic, 20) }),
      h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, title), h('span', { class: 'ou-row-sub' }, sub)));
    return {
      el: h('div', null, ...head('check', '#22b07d', t('onb.doneTitle'), t('onb.doneSub')),
        h('div', { class: 'ou-card ou-list onb-tips' },
          tip('keyboard', '#5b6472', t('onb.tip.type'), t('onb.tip.typeSub')),
          tip('down', '#3e7bff', t('onb.tip.panel'), t('onb.tip.panelSub')),
          tip('widgets', '#8e6bff', t('onb.tip.edit'), t('onb.tip.editSub')))),
      next: () => t('onb.start'),
    };
  },
};

/** A tiny screen in light, dark or both (Automatic), like One UI's Light/Dark previews in Display settings. */
function mock(mode) {
  const screen = (cls) => h('span', { class: ['onb-mock-screen', cls] },
    h('i', { class: 'm-wg' }), h('i', { class: 'm-wg s' }), h('span', { class: 'm-icons' }, ...Array.from({ length: 8 }, () => h('i'))), h('i', { class: 'm-dock' }));
  return h('span', { class: ['onb-mock', 'm-' + mode] }, mode === 'auto' ? [screen('light'), screen('dark half')] : screen(mode));
}

// ——— Home screen: the person's own sites ———
async function topSites() {
  if (!isExt || !chrome.topSites) return [];
  try {
    return (await chrome.topSites.get()).filter((s) => /^https?:/.test(s.url)).slice(0, 12);
  } catch {
    return [];
  }
}

function cleanTitle(title, url) {
  const t1 = (title || '').split(/ [-–|·•:] /)[0].trim();
  return t1 && t1.length <= 18 ? t1 : siteName(url);
}

/**
 * Puts the person's most visited sites on the first Home screen page in Chrome's order. Starter websites that aren't
 * among them make room (widgets, apps and folders stay); sites already elsewhere (other pages, folders, dock) are not
 * added twice. home.js picks the change up from the store and moves anything that no longer fits to the next page.
 */
export function addMySites(top) {
  const pages = store.get('home');
  if (!Array.isArray(pages) || !top?.length) return;
  const wanted = new Set(top.map((s) => hostname(s.url)));
  const first = (pages[0] || []).filter((it) => it.type !== 'site' || wanted.has(hostname(it.url)));
  const rest = pages.slice(1).map((p) => p.filter((it) => it.type !== 'site' || wanted.has(hostname(it.url))));
  const elsewhere = new Set();
  const walk = (it) => (it.type === 'folder' ? (it.items || []).forEach(walk) : it.type === 'site' && elsewhere.add(hostname(it.url)));
  rest.flat().forEach(walk);
  first.filter((it) => it.type === 'folder').forEach(walk);
  (store.get('dock') || []).forEach(walk);
  const onFirst = new Map(first.filter((it) => it.type === 'site').map((it) => [hostname(it.url), it]));
  const seen = new Set();
  const sites = top.filter((s) => {
    const host = hostname(s.url);
    if (elsewhere.has(host) || seen.has(host)) return false;
    seen.add(host);
    return true;
  }).map((s) => onFirst.get(hostname(s.url)) || { id: uid(), type: 'site', url: s.url, title: cleanTitle(s.title, s.url) });
  store.set('home', [[...first.filter((it) => it.type !== 'site'), ...sites], ...rest.filter((p) => p.length)]);
}

addStrings({
  en: {
    'onb.aria': 'Welcome to Bloom Tab',
    'onb.welcome': 'Welcome!',
    'onb.welcomeSub': 'Bloom Tab turns every new tab into a One UI home screen. Let’s set it up, it only takes a minute.',
    'onb.getStarted': 'Get started',
    'onb.next': 'Next',
    'onb.back': 'Back',
    'onb.skip': 'Skip',
    'onb.start': 'Start',
    'onb.langTitle': 'Choose your language',
    'onb.langSub': 'Bloom Tab can show everything in English or Arabic.',
    'onb.lang.en': 'English',
    'onb.lang.ar': 'Arabic',
    'onb.themeTitle': 'Light or dark?',
    'onb.themeSub': 'Pick the look you like. You can change it any time in Settings.',
    'onb.light': 'Light',
    'onb.dark': 'Dark',
    'onb.auto': 'Automatic',
    'onb.autoSub': 'Follows your device',
    'onb.wallTitle': 'Choose a wallpaper',
    'onb.wallSub': 'Your accent colour comes from the wallpaper, like Color palette on a Galaxy.',
    'onb.wallN': 'Wallpaper {n}',
    'onb.homeTitle': 'Set up your Home screen',
    'onb.homeSub': 'Start with the websites you visit most, or keep a starter layout you can change later.',
    'onb.homeMine': 'Add my sites',
    'onb.homeMineSub': 'Your most visited sites from Chrome',
    'onb.homeMineNone': 'Chrome hasn’t found your most visited sites yet',
    'onb.homeStarter': 'Keep the starter layout',
    'onb.homeStarterSub': 'Popular websites, widgets and apps',
    'onb.searchTitle': 'Search and AI',
    'onb.searchSub': 'Finder looks through your apps and sites first. For the web, choose where your searches go.',
    'onb.engine': 'Search engine',
    'onb.ai': 'AI assistant',
    'onb.aiSub': 'In Finder, press Tab to ask your AI assistant instead of searching.',
    'onb.permTitle': 'Find more with Finder',
    'onb.permSub': 'Finder can also search your bookmarks and history. Chrome asks for permission first, and nothing leaves this computer. You can skip this.',
    'onb.bookmarks': 'Bookmarks',
    'onb.bookmarksSub': 'Search the pages you saved',
    'onb.history': 'History',
    'onb.historySub': 'Search the pages you visited',
    'onb.permDenied': 'Permission not granted',
    'onb.lockTitle': 'Choose a Lock screen style',
    'onb.lockSub': 'The Lock screen shows the time, widgets and notifications when you come back to a new tab.',
    'onb.clock.stacked': 'Stacked',
    'onb.clock.classic': 'Classic',
    'onb.clock.thin': 'Thin',
    'onb.clock.left': 'Left',
    'onb.font': 'Clock font',
    'onb.font.outfit': 'Outfit',
    'onb.font.inter': 'Inter',
    'onb.font.serif': 'Serif',
    'onb.font.mono': 'Mono',
    'onb.doneTitle': 'You’re all set',
    'onb.doneSub': 'Here are a few things to try first.',
    'onb.tip.type': 'Just start typing',
    'onb.tip.typeSub': 'Search the web, open apps, do maths or set a timer from anywhere.',
    'onb.tip.panel': 'Quick panel',
    'onb.tip.panelSub': 'Press ↓ or Alt+Q for quick settings, music and notifications.',
    'onb.tip.edit': 'Make it yours',
    'onb.tip.editSub': 'Right-click the Home screen to add widgets, websites and folders.',
  },
  ar: {
    'onb.aria': 'مرحبًا بك في Bloom Tab',
    'onb.welcome': 'أهلًا بك!',
    'onb.welcomeSub': 'يحوّل Bloom Tab كل علامة تبويب جديدة إلى شاشة رئيسية بأسلوب One UI. لنبدأ الإعداد، فلن يستغرق سوى دقيقة.',
    'onb.getStarted': 'ابدأ الآن',
    'onb.next': 'التالي',
    'onb.back': 'رجوع',
    'onb.skip': 'تخطٍّ',
    'onb.start': 'ابدأ',
    'onb.langTitle': 'اختر لغتك',
    'onb.langSub': 'يمكن لـ Bloom Tab عرض كل شيء بالعربية أو الإنجليزية.',
    'onb.lang.en': 'الإنجليزية',
    'onb.lang.ar': 'العربية',
    'onb.themeTitle': 'فاتح أم داكن؟',
    'onb.themeSub': 'اختر المظهر الذي يعجبك. يمكنك تغييره في أي وقت من الإعدادات.',
    'onb.light': 'فاتح',
    'onb.dark': 'داكن',
    'onb.auto': 'تلقائي',
    'onb.autoSub': 'يتبع جهازك',
    'onb.wallTitle': 'اختر خلفية',
    'onb.wallSub': 'يأتي لون التمييز من الخلفية، مثل لوحة الألوان في أجهزة Galaxy.',
    'onb.wallN': 'الخلفية {n}',
    'onb.homeTitle': 'إعداد الشاشة الرئيسية',
    'onb.homeSub': 'ابدأ بالمواقع التي تزورها كثيرًا، أو احتفظ بتخطيط البداية ويمكنك تغييره لاحقًا.',
    'onb.homeMine': 'إضافة مواقعي',
    'onb.homeMineSub': 'المواقع الأكثر زيارة من Chrome',
    'onb.homeMineNone': 'لم يعثر Chrome بعد على المواقع الأكثر زيارة لديك',
    'onb.homeStarter': 'الاحتفاظ بتخطيط البداية',
    'onb.homeStarterSub': 'مواقع شائعة وأدوات وتطبيقات',
    'onb.searchTitle': 'البحث والذكاء الاصطناعي',
    'onb.searchSub': 'يبحث Finder في تطبيقاتك ومواقعك أولًا. أما على الويب، فاختر أين تذهب عمليات بحثك.',
    'onb.engine': 'محرك البحث',
    'onb.ai': 'مساعد الذكاء الاصطناعي',
    'onb.aiSub': 'في Finder، اضغط Tab لسؤال مساعد الذكاء الاصطناعي بدلًا من البحث.',
    'onb.permTitle': 'اعثر على المزيد باستخدام Finder',
    'onb.permSub': 'يمكن لـ Finder أيضًا البحث في إشاراتك المرجعية وسجلك. سيطلب Chrome الإذن أولًا، ولا يغادر أي شيء هذا الكمبيوتر. يمكنك تخطي هذه الخطوة.',
    'onb.bookmarks': 'الإشارات المرجعية',
    'onb.bookmarksSub': 'ابحث في الصفحات التي حفظتها',
    'onb.history': 'السجل',
    'onb.historySub': 'ابحث في الصفحات التي زرتها',
    'onb.permDenied': 'لم يتم منح الإذن',
    'onb.lockTitle': 'اختر نمط شاشة القفل',
    'onb.lockSub': 'تعرض شاشة القفل الوقت والأدوات والإشعارات عندما تعود إلى علامة تبويب جديدة.',
    'onb.clock.stacked': 'مكدّس',
    'onb.clock.classic': 'كلاسيكي',
    'onb.clock.thin': 'رفيع',
    'onb.clock.left': 'يسار',
    'onb.font': 'خط الساعة',
    'onb.font.outfit': 'Outfit',
    'onb.font.inter': 'Inter',
    'onb.font.serif': 'Serif',
    'onb.font.mono': 'Mono',
    'onb.doneTitle': 'أنت جاهز تمامًا',
    'onb.doneSub': 'إليك بعض الأشياء لتجربتها أولًا.',
    'onb.tip.type': 'ابدأ الكتابة فقط',
    'onb.tip.typeSub': 'ابحث في الويب أو افتح التطبيقات أو احسب أو اضبط مؤقتًا من أي مكان.',
    'onb.tip.panel': 'اللوحة السريعة',
    'onb.tip.panelSub': 'اضغط ↓ أو Alt+Q للإعدادات السريعة والموسيقى والإشعارات.',
    'onb.tip.edit': 'اجعلها خاصة بك',
    'onb.tip.editSub': 'انقر بزر الماوس الأيمن على الشاشة الرئيسية لإضافة الأدوات والمواقع والمجلدات.',
  },
});
