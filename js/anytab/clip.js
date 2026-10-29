// The "Add to Home screen" sheet for the website you were on (addsite.html, shown over the page by js/bg/anytab.js):
// the site's icon (its touch icon when it has one, as a phone would use), an editable name, Home screen or Edge panel,
// and "Open as web app". Items land in store `home` (after the last icon, like One UI) or `edge`; touch icons are
// kept per address in `clipIcons` (local storage only), which js/shell/appicon.js draws for that site.
import { h, uid, toUrl, hostname, siteName } from '../core/util.js';
import { store } from '../core/store.js';
import { t } from '../core/i18n.js';
import { dialog, seg, switchRow, list, toast } from '../core/ui.js';
import { siteIconEl } from '../shell/appicon.js';
import { prettyUrl } from './page.js';

const EDGE_MAX = 12; // as in js/shell/edge.js
const EDGE_SEED = ['notes', 'calculator', 'reminder', 'calendar', 'clock', 'weather'];

/** The site's own name from its address ("github.com" → "Github"); addresses without a name stay as they are. */
function siteOf(url) {
  const host = hostname(url || '');
  if (!host || /^[\d.:[\]]+$|^localhost$/i.test(host)) return host;
  return siteName(url);
}

const fold = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const cut = (s) => (s.length > 40 ? s.slice(0, 39).trimEnd() + '…' : s);
/**
 * A short name for the Home screen: the name the site gives its web app; for a home page, the part of the title that
 * names the site ("GitHub" from "GitHub: Let's build from here"); for any other page, the page's own part of the
 * title ("Cat" from "Cat - Wikipedia"); else the site's name from its address.
 */
export function clipName({ url = '', title = '', appTitle = '', siteName: sn = '' } = {}) {
  if (appTitle.trim()) return cut(appTitle.trim());
  const site = siteOf(url), fs = fold(site);
  const parts = String(title).replace(/^\(\d+\+?\)\s*/, '').split(/\s+[-–—|·•:]\s+|:\s+/).map((s) => s.trim()).filter(Boolean);
  const isSite = (s) => (fs && fold(s).includes(fs)) || (sn && fold(s) === fold(sn));
  let path = '';
  try {
    const u = new URL(url);
    path = u.pathname.replace(/\/+$/, '') + u.search;
  } catch {}
  const own = path ? parts.find((s) => !isSite(s)) : '';
  return cut(own || parts.find(isSite) || sn || (parts[0]?.length <= 24 ? parts[0] : '') || site || '');
}

/** Every site address on the Home screen, the dock and the Edge panel (folders included). */
function usedUrls() {
  const out = new Set();
  const walk = (it) => {
    if (!it || typeof it !== 'object') return;
    if (it.type === 'folder') (it.items || []).forEach(walk);
    else if (it.url) out.add(it.url);
  };
  (store.get('home') || []).flat().forEach(walk);
  (store.get('dock') || []).forEach(walk);
  (store.get('edge') || []).forEach(walk);
  return out;
}

/** Keeps a touch icon for `url` and forgets those of sites that are no longer anywhere. Call before adding the item, so
 *  Home screens redraw with the icon already there. */
export function saveClipIcon(url, icon) {
  if (!url || !/^data:image\//.test(icon || '')) return;
  const used = usedUrls();
  store.update('clipIcons', (m) => {
    const out = {};
    for (const [k, v] of Object.entries(m && typeof m === 'object' ? m : {})) if (used.has(k)) out[k] = v;
    out[url] = icon;
    return out;
  });
}

/** Like One UI, a new icon goes after the last one on the Home screen (a full page passes it on to a new one). */
export function addToHome({ url, name, icon, webApp }) {
  saveClipIcon(url, icon);
  const item = { id: uid(), type: 'site', url, title: name || siteOf(url), ...(webApp ? { webApp: true } : {}) };
  store.update('home', (pages) => {
    const p = Array.isArray(pages) && pages.length ? pages : [[]];
    if (!Array.isArray(p[p.length - 1])) p[p.length - 1] = [];
    p[p.length - 1].push(item);
    return p;
  });
  return item;
}

const edgeList = () => {
  const l = store.get('edge');
  // never opened yet: start from the Edge panel's own starter apps, as js/shell/edge.js would
  return Array.isArray(l) ? l : EDGE_SEED.map((app) => ({ id: uid(), type: 'app', app }));
};
/** null when the site can go into the Edge panel, else 'already' or 'full'. */
export function edgeProblem(url) {
  const l = edgeList();
  if (l.some((x) => x.type !== 'app' && x.url === url)) return 'already';
  return l.length >= EDGE_MAX ? 'full' : null;
}
export function addToEdge({ url, name, icon, webApp }) {
  if (edgeProblem(url)) return null;
  saveClipIcon(url, icon);
  const item = { id: uid(), type: 'site', url, title: name || siteOf(url), ...(webApp ? { webApp: true } : {}) };
  store.set('edge', [...edgeList(), item]);
  return item;
}

/**
 * Opens the sheet for clip = { url, title, appTitle, siteName, icon, where }. Resolves { where, item, message } once
 * added, or null when cancelled; setIcon(dataUrl) shows a touch icon that arrives after the sheet opened.
 */
export function openAddSheet(clip = {}) {
  let icon = clip.icon || '';
  let where = clip.where === 'edge' ? 'edge' : 'home';
  let webApp = false;
  const suggested = clipName(clip);
  const fixedUrl = /^https?:/i.test(clip.url || '') ? clip.url : '';
  const currentUrl = () => fixedUrl || toUrl(urlIn?.value || '') || '';

  const name = h('input', { class: 'at-name', value: suggested, placeholder: suggested || t('anytab.name'), 'aria-label': t('anytab.name'), autocomplete: 'off', spellcheck: 'false', maxlength: 60 });
  const urlIn = fixedUrl ? null : h('input', { class: 'at-url-in', type: 'text', inputmode: 'url', dir: 'ltr', placeholder: t('anytab.urlPh'), 'aria-label': t('anytab.urlPh'), autocomplete: 'off', spellcheck: 'false' });
  const preview = h('div', { class: 'at-icon' });
  const note = h('div', { class: 'at-foot' });
  const draw = () => {
    const url = currentUrl() || 'https://example.invalid/';
    preview.replaceChildren(siteIconEl({ url, title: name.value.trim() || suggested || siteOf(url), icon }));
  };
  const drawNote = () => (note.textContent = t(where === 'edge' ? 'anytab.noteEdge' : 'anytab.noteHome'));
  const choice = seg([{ value: 'home', label: t('anytab.toHome'), icon: 'home' }, { value: 'edge', label: t('anytab.toEdge'), icon: 'edge' }], where, (v) => {
    where = v;
    drawNote();
  });
  choice.classList.add('at-where');
  const appRow = switchRow({ icon: 'tab', title: t('anytab.webApp'), sub: t('anytab.webAppSub'), checked: false, onChange: (v) => (webApp = v) });
  appRow.classList.add('muted-sub', 'at-webapp');

  const content = h('div', { class: 'at-add' },
    h('div', { class: 'at-site' }, preview,
      h('div', { class: 'at-fields' },
        urlIn,
        name,
        fixedUrl ? h('bdi', { class: 'at-url', dir: 'ltr' }, prettyUrl(fixedUrl)) : null)),
    h('div', { class: 'at-label' }, t('anytab.addTo')),
    choice,
    list(appRow),
    note);
  draw();
  drawNote();
  name.addEventListener('input', draw);
  urlIn?.addEventListener('input', () => {
    const u = toUrl(urlIn.value);
    if (!name.dataset.touched) name.value = u ? siteOf(u) : '';
    draw();
  });
  name.addEventListener('input', () => (name.dataset.touched = '1'));

  const done = dialog({
    title: t('anytab.addTitle'),
    content,
    className: 'at-sheet at-add-sheet',
    actions: [
      { label: t('common.cancel'), value: null },
      {
        label: t('common.add'),
        primary: true,
        validate: () => {
          const url = currentUrl();
          if (!url) {
            toast(t('anytab.badUrl'));
            urlIn?.focus();
            return false;
          }
          const p = where === 'edge' && edgeProblem(url);
          if (p) {
            toast(t(p === 'full' ? 'anytab.edgeFull' : 'anytab.edgeAlready'));
            return false;
          }
          return true;
        },
        value: () => {
          const url = currentUrl();
          const data = { url, name: name.value.trim() || suggested || siteOf(url), icon, webApp };
          const item = where === 'edge' ? addToEdge(data) : addToHome(data);
          return { where, item, message: t(where === 'edge' ? 'anytab.addedEdge' : 'anytab.addedHome') };
        },
      },
    ],
  });
  setTimeout(() => {
    const f = urlIn || name;
    f.focus();
    if (f === name) name.select();
  }, 90);
  return {
    done,
    setIcon(src) {
      if (src && src !== icon) {
        icon = src;
        draw();
      }
    },
  };
}
