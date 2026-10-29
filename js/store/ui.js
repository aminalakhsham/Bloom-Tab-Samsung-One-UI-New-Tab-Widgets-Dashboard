// Galaxy Store for websites, the screens (One UI): the floating bottom bar switches Discover, Categories, Top, Search
// and Menu; every site has its own page with Install/Open, the Wish list heart and Uninstall in ⋮. Install puts the site
// on the Home screen with its short name; each Install/Open button follows the Home screen (`home`/`dock` keys), so a
// site removed there shows Install again.
import { h, toUrl, hostname, siteName } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, addStrings, fmtDate, locale } from '../core/i18n.js';
import { store } from '../core/store.js';
import { toast, menu, confirm, dialog, iconBtn, row, list, seg } from '../core/ui.js';
import { openUrl } from '../shell/appicon.js';
import { addSite } from '../shell/home.js';
import * as M from './model.js';
import * as D from './data.js';
import { siteIcon, hueOf } from './icon.js';

const TABS = [
  { id: 'discover', icon: 'gsCompass' },
  { id: 'categories', icon: 'widgets' },
  { id: 'top', icon: 'gsChart' },
  { id: 'search', icon: 'search' },
  { id: 'menu', icon: 'gsMenu' },
];
const reduceMotion = () => document.documentElement.dataset.motion === 'reduce';
const enter = (e) => {
  if (e.key === 'Enter' && e.target === e.currentTarget) e.currentTarget.click();
};
/** A site the catalog doesn't list (a typed address, another Home screen website) shaped like a catalog app. */
const looseApp = (url, title) => {
  const host = hostname(url).toLowerCase();
  return { site: host, host, name: title || siteName(url), label: title || siteName(url), cat: 'other', url, loose: true };
};

let topCat = null; // the Top tab's category chip, kept while the window is open

export function render(ctx) {
  let query = '';
  let current = null; // the tab page on screen
  const watchers = new Set();
  const watch = (fn) => (watchers.add(fn), () => watchers.delete(fn));

  // ——— Install / Open ———
  function paintBtn(b, app, installed) {
    if (b.classList.contains('busy')) return;
    b.classList.toggle('open', installed);
    b.textContent = installed ? t('store.open') : t('store.install');
    b.setAttribute('aria-label', installed ? `${t('store.open')} ${app.label}` : t('store.installName', { name: app.label }));
  }
  function getBtn(app, { big = false, hosts = D.installedHosts() } = {}) {
    const b = h('button', { class: ['gs-get', big && 'big'], dataset: { host: app.host }, onClick: (e) => {
      e.stopPropagation();
      press(app, b, e);
    } });
    b._app = app;
    paintBtn(b, app, D.isInstalled(app, hosts));
    return b;
  }
  function press(app, b, e) {
    if (b.classList.contains('busy')) return;
    if (D.isInstalled(app)) return openUrl(app.url, e);
    // a moment of progress, like Galaxy Store's download, then the site is on the Home screen and the button says Open
    b.classList.add('busy');
    setTimeout(() => {
      b.classList.remove('busy');
      if (app.loose) {
        addSite(app.url);
        toast(t('store.installed', { name: app.label }), { action: t('store.open'), onAction: () => openUrl(app.url) });
      } else D.install(app);
      refresh();
    }, reduceMotion() ? 0 : 650);
  }
  /** Repaints every button and tile in the window (all pages of the stack), then the pages that list installed sites. */
  function refresh() {
    const hosts = D.installedHosts();
    for (const b of ctx.win.querySelectorAll('.gs-get[data-host]')) if (b._app) paintBtn(b, b._app, hosts.has(b.dataset.host));
    for (const el of ctx.win.querySelectorAll('.gs-tile[data-host]')) el.classList.toggle('inst', hosts.has(el.dataset.host));
    watchers.forEach((fn) => fn());
  }

  // ——— building blocks ———
  const section = (title, content, more) => h('section', { class: 'gs-sec' },
    h('div', { class: 'gs-sec-h' }, h('h2', null, title), more ? h('button', { class: 'gs-more', title: t('store.viewAll'), 'aria-label': t('store.viewAll'), html: icon('forward', 20), onClick: more }) : null),
    content);
  const tile = (app, hosts) => h('button', { class: ['gs-tile', hosts.has(app.host) && 'inst'], dataset: { host: app.host, site: app.site }, onClick: () => openDetail(app) },
    siteIcon(app, 64),
    h('span', { class: 'gs-tile-name', dir: 'auto' }, app.label),
    h('span', { class: 'gs-tile-sub' }, h('span', { class: 'gs-tile-cat' }, D.catName(app.cat)), h('span', { class: 'gs-tile-inst' }, t('store.installedState'))));
  const hrow = (apps, hosts = D.installedHosts()) => h('div', { class: 'gs-hrow' }, apps.map((a) => tile(a, hosts)));
  const subOf = (app) => [D.catName(app.cat), ' · ', h('bdi', null, app.host)];
  function appRow(app, { rank = 0, hosts, name, sub, onOpen } = {}) {
    const open = onOpen || (app.loose ? null : () => openDetail(app));
    return h('div', { class: ['gs-row', !open && 'static'], role: open ? 'button' : null, tabindex: open ? 0 : null, dataset: { site: app.site }, onClick: open, onKeydown: open ? enter : null },
      rank ? h('span', { class: 'gs-rank' }, String(rank)) : null,
      siteIcon(app, 52),
      h('span', { class: 'gs-row-text' }, h('span', { class: 'gs-row-name', dir: 'auto' }, name || app.name), h('span', { class: 'gs-row-sub' }, sub || subOf(app))),
      getBtn(app, { hosts }));
  }
  const rows = (apps, { ranked = false, hosts = D.installedHosts(), onOpen } = {}) =>
    h('div', { class: 'gs-list' }, apps.map((a, i) => appRow(a, { rank: ranked ? i + 1 : 0, hosts, onOpen: onOpen && (() => onOpen(a)) })));
  const catBadge = (id, size = 20) => h('span', { class: 'gs-badge', style: { background: M.CATS[id].color }, html: icon(M.CATS[id].icon, size) });
  const empty = (ic, text) => h('div', { class: 'ou-empty gs-empty' }, h('span', { html: icon(ic, 56) }), text);

  // ——— tabs ———
  const nav = (active) => h('nav', { class: 'ou-tabs gs-nav', role: 'tablist', 'aria-label': t('app.store') }, TABS.map((tb) =>
    h('button', {
      class: ['ou-tab', tb.id === active && 'active'],
      role: 'tab',
      'aria-selected': String(tb.id === active),
      dataset: { tab: tb.id },
      onClick: () => (tb.id === active ? current?.scrollEl.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }) : show(tb.id)),
    }, h('span', { html: icon(tb.icon, 20) }), h('span', null, t('store.tab.' + tb.id)))));

  /** A tab's page: no big title (Galaxy Store has none), the bottom bar, and `fill` may return a cleanup. */
  function tabPage(id, fill, { actions = [] } = {}) {
    current = ctx.page({
      title: t('store.tab.' + id),
      hero: false,
      className: 'gs-page gs-tab-' + id,
      actions,
      render: (body, page) => {
        body.classList.add('gs-body');
        page.el.appendChild(nav(id));
        return fill(body, page);
      },
    });
    current.el.dataset.tab = id;
  }
  const VIEWS = { discover: discoverView, categories: categoriesView, top: topView, search: searchView, menu: menuView };
  const show = (id) => VIEWS[id]();

  // Discover: banners, Must-have, Today's pick, Top websites, Popular in … (all but the chart change every day)
  function discoverView() {
    tabPage('discover', (body) => {
      const d = M.discover();
      const hosts = D.installedHosts();
      body.append(
        banners(d.banners),
        section(t('store.mustHave'), hrow(d.mustHave, hosts)),
        pickCard(d.pick, hosts),
        section(t('store.topSites'), h('div', { class: 'gs-cols' }, d.top.map((a, i) => appRow(a, { rank: i + 1, hosts }))), () => show('top')),
        ...d.popular.map((p) => section(t('store.popularIn', { category: D.catName(p.cat) }), hrow(p.apps, hosts), () => openCategory(p.cat))),
      );
    });
  }
  function banners(list) {
    const strip = h('div', { class: 'gs-banners' }, list.map((b) => h('button', { class: 'gs-banner', dataset: { cat: b.cat }, style: { '--c': M.CATS[b.cat].color }, onClick: () => openCategory(b.cat) },
      h('span', { class: 'gs-banner-art' }, b.apps.map((a) => siteIcon(a, 58))),
      h('span', { class: 'gs-banner-text' },
        h('small', null, t('store.kick.' + b.cat)),
        h('strong', null, t('store.banner.' + b.cat)),
        h('span', { class: 'gs-banner-cat' }, h('span', { html: icon(M.CATS[b.cat].icon, 14) }), D.catName(b.cat))))));
    const dots = h('div', { class: 'gs-dots', 'aria-hidden': 'true' }, list.map((_, i) => h('span', { class: i === 0 && 'on' })));
    strip.addEventListener('scroll', () => {
      const max = strip.scrollWidth - strip.clientWidth;
      const i = max > 0 ? Math.round((Math.abs(strip.scrollLeft) / max) * (list.length - 1)) : 0;
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    }, { passive: true });
    return h('div', { class: 'gs-banner-wrap' }, strip, dots);
  }
  function pickCard(app, hosts) {
    return h('div', { class: 'gs-pick', role: 'button', tabindex: 0, style: { '--h': hueOf(app) }, onClick: () => openDetail(app), onKeydown: enter },
      h('div', { class: 'gs-pick-kick' }, h('span', { html: icon('starFill', 14) }), h('span', null, t('store.widget')), h('span', { class: 'gs-pick-date' }, fmtDate(new Date(), { month: 'long', day: 'numeric' }))),
      h('div', { class: 'gs-pick-main' }, siteIcon(app, 72),
        h('div', { class: 'gs-pick-text' }, h('div', { class: 'gs-pick-name', dir: 'auto' }, app.name), h('div', { class: 'gs-pick-sub' }, subOf(app)))),
      h('p', { class: 'gs-pick-desc' }, D.describe(app)[0]),
      getBtn(app, { big: true, hosts }));
  }

  // Categories: Galaxy Store's list, a coloured round icon per category
  function categoriesView() {
    tabPage('categories', (body) => {
      const sep = locale().startsWith('ar') ? '، ' : ', ';
      body.append(h('div', { class: 'ou-card ou-list gs-cats' }, M.CAT_ORDER.map((id) => {
        const r = row({
          icon: icon(M.CATS[id].icon, 20),
          iconBg: M.CATS[id].color,
          title: D.catName(id),
          sub: t('store.catSub', { names: M.inCat(id).slice(0, 3).map((a) => a.label).join(sep) }),
          right: h('span', { class: 'gs-count' }, String(M.inCat(id).length)),
          chevron: true,
          onClick: () => openCategory(id),
          className: 'muted-sub',
        });
        r.dataset.cat = id;
        return r;
      })));
    });
  }
  function openCategory(id) {
    const name = D.catName(id);
    ctx.push({
      title: name,
      hero: false,
      className: 'gs-page gs-catpage',
      render: (body) => {
        body.classList.add('gs-body');
        let mode = 'popular';
        const box = h('div');
        const collator = new Intl.Collator(locale());
        const draw = () => box.replaceChildren(rows(mode === 'az' ? M.alphabetical(id, collator.compare) : M.inCat(id), { ranked: mode === 'popular' }));
        body.append(
          h('div', { class: 'gs-cat-head', dataset: { cat: id } }, catBadge(id, 26), h('div', null, h('b', null, name), h('small', null, t('store.count', { n: M.inCat(id).length })))),
          seg([{ value: 'popular', label: t('store.popular') }, { value: 'az', label: t('store.az') }], mode, (v) => {
            mode = v;
            draw();
          }),
          box);
        draw();
      },
    });
  }

  // Top: the overall chart (round robin across categories) or one category's, picked with the chips
  function topView() {
    tabPage('top', (body) => {
      const box = h('div');
      const chips = h('div', { class: 'ou-chips gs-chips' }, [null, ...M.CAT_ORDER].map((id) => h('button', {
        class: ['ou-chip', id === topCat && 'active'],
        dataset: { cat: id || 'all' },
        onClick: (e) => {
          topCat = id;
          chips.querySelectorAll('.ou-chip').forEach((c) => c.classList.toggle('active', c === e.currentTarget));
          draw();
        },
      }, id ? D.catName(id) : t('store.all'))));
      const draw = () => box.replaceChildren(rows(M.topChart(100, topCat), { ranked: true }));
      body.append(chips, box);
      draw();
      requestAnimationFrame(() => chips.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
    });
  }

  // Search: the field sits in the app bar; empty, it shows recent and popular searches
  function searchView() {
    tabPage('search', (body, page) => {
      const input = h('input', { type: 'search', class: 'gs-q', placeholder: t('store.searchPh'), 'aria-label': t('store.searchPh'), value: query, spellcheck: 'false', autocomplete: 'off', enterkeyhint: 'search' });
      const clear = h('button', { class: 'gs-q-clear', title: t('store.clear'), 'aria-label': t('store.clear'), html: icon('close', 18), hidden: !query, onClick: () => {
        input.value = query = '';
        clear.hidden = true;
        draw();
        input.focus();
      } });
      const bar = h('label', { class: 'ou-searchbox gs-search' }, h('span', { html: icon('search', 20) }), input, clear);
      page.el.querySelector('.app-toolbar').insertBefore(bar, page.el.querySelector('.app-toolbar-actions'));
      input.addEventListener('input', () => {
        query = input.value;
        clear.hidden = !query;
        draw();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') D.addRecent(query);
        if (e.key === 'Escape' && query) {
          e.preventDefault();
          e.stopPropagation();
          clear.click();
        }
      });
      const box = h('div', { class: 'gs-results' });
      body.append(box);
      const fromSearch = (app) => {
        D.addRecent(query);
        openDetail(app);
      };
      function draw() {
        const q = query.trim();
        if (!q) return box.replaceChildren(...idle());
        const nq = M.norm(q);
        const hosts = D.installedHosts();
        const out = [];
        const cats = M.CAT_ORDER.filter((id) => M.norm(D.catName(id)).includes(nq) || id.startsWith(nq));
        if (cats.length) out.push(section(t('store.categories'), h('div', { class: 'ou-card ou-list gs-cats' }, cats.map((id) => row({ icon: icon(M.CATS[id].icon, 20), iconBg: M.CATS[id].color, title: D.catName(id), sub: t('store.count', { n: M.inCat(id).length }), chevron: true, className: 'muted-sub', onClick: () => (D.addRecent(q), openCategory(id)) })))));
        // any typed address: the catalog's page if it lists the site, else a plain Add to Home screen row
        const url = toUrl(q);
        const listed = url && M.appForHost(hostname(url));
        let apps = M.searchApps(q, { limit: 30 });
        if (listed) apps = [listed, ...apps.filter((a) => a !== listed)];
        else if (url) {
          const loose = looseApp(url);
          out.push(h('div', { class: 'gs-list gs-address' }, appRow(loose, { hosts, name: t('store.addHost', { host: D.ltr(loose.host) }), sub: [t('store.address'), ' · ', h('bdi', null, url.replace(/^https?:\/\//, ''))] })));
        }
        if (apps.length) out.push(section(t('store.websites'), rows(apps, { hosts, onOpen: fromSearch })));
        box.replaceChildren(...(out.length ? out : [empty('search', t('store.noResults'))]));
      }
      function idle() {
        const recent = D.recentSearches();
        const pick = (q) => {
          input.value = query = q;
          clear.hidden = false;
          draw();
        };
        return [
          recent.length ? h('section', { class: 'gs-sec' },
            h('div', { class: 'gs-sec-h' }, h('h2', null, t('store.recent')), h('button', { class: 'gs-textbtn', onClick: () => {
              D.clearRecent();
              draw();
            } }, t('store.clearAll'))),
            h('div', { class: 'gs-recent' }, recent.map((q) => h('span', { class: 'ou-chip gs-recent-chip' },
              h('button', { class: 'gs-recent-q', dir: 'auto', onClick: () => pick(q) }, q),
              h('button', { class: 'gs-recent-x', title: t('common.remove'), 'aria-label': t('common.remove'), html: icon('close', 14), onClick: () => {
                D.removeRecent(q);
                draw();
              } }))))) : null,
          section(t('store.popularSearches'), h('ol', { class: 'gs-popular' }, M.popularSearches().map((a, i) =>
            h('li', null, h('button', { onClick: () => pick(a.label) }, h('b', null, String(i + 1)), h('span', { dir: 'auto' }, a.label)))))),
        ].filter(Boolean);
      }
      draw();
      setTimeout(() => input.focus(), 60);
    });
  }

  // Menu: My apps, Wish list, search history and About, under a Galaxy Store header card
  function menuView() {
    tabPage('menu', (body) => {
      const draw = () => {
        const hosts = D.installedHosts();
        const mine = M.APPS.filter((a) => hosts.has(a.host)).length + D.otherHomeSites().length;
        const count = (n) => h('span', { class: 'gs-count' }, String(n));
        body.replaceChildren(
          h('div', { class: 'ou-card gs-me' },
            h('span', { class: 'gs-me-logo', html: icon('gsBag', 30) }),
            h('div', { class: 'gs-me-text' }, h('b', null, t('app.store')), h('small', null, t('store.menuSub', { n: M.APPS.length, m: mine })))),
          list(
            row({ icon: 'apps', title: t('store.myApps'), sub: t('store.myAppsSub'), right: count(mine), chevron: true, className: 'muted-sub gs-my', onClick: openMyApps }),
            row({ icon: 'gsHeart', title: t('store.wishList'), right: count(D.wishList().length), chevron: true, className: 'gs-wish', onClick: openWishList })),
          list(
            row({ icon: 'history', title: t('store.clearHistory'), className: 'gs-clear', onClick: () => {
              D.clearRecent();
              toast(t('store.historyCleared'));
            } }),
            row({ icon: 'info', title: t('store.aboutStore'), className: 'gs-about-row', onClick: () => dialog({ title: t('store.aboutStore'), message: t('store.aboutText', { n: M.APPS.length, c: M.CAT_ORDER.length }) }) })));
      };
      draw();
      const off = store.on('storeWish', draw);
      const unwatch = watch(draw);
      return () => (off(), unwatch());
    });
  }
  function openMyApps() {
    ctx.push({
      title: t('store.myApps'),
      hero: false,
      className: 'gs-page gs-mine',
      render: (body) => {
        body.classList.add('gs-body');
        const collator = new Intl.Collator(locale());
        const draw = () => {
          const hosts = D.installedHosts();
          const mine = M.APPS.filter((a) => hosts.has(a.host)).sort((a, b) => collator.compare(a.name, b.name));
          const seen = new Set();
          const others = D.otherHomeSites().map((it) => looseApp(it.url, it.title)).filter((a) => !seen.has(a.host) && seen.add(a.host));
          body.replaceChildren(...(mine.length || others.length ? [
            mine.length ? rows(mine, { hosts }) : null,
            others.length ? section(t('store.otherSites'), rows(others, { hosts })) : null,
          ].filter(Boolean) : [empty('apps', t('store.myAppsEmpty'))]));
        };
        draw();
        return watch(draw);
      },
    });
  }
  function openWishList() {
    ctx.push({
      title: t('store.wishList'),
      hero: false,
      className: 'gs-page gs-wishpage',
      render: (body) => {
        body.classList.add('gs-body');
        const draw = () => {
          const apps = D.wishList().map((s) => M.BY_SITE.get(s));
          body.replaceChildren(apps.length ? rows(apps) : empty('gsHeart', t('store.wishEmpty')));
        };
        draw();
        return store.on('storeWish', draw);
      },
    });
  }

  // ——— a site's page ———
  function openDetail(app) {
    const heart = iconBtn(D.isWished(app) ? 'gsHeartFill' : 'gsHeart', () => {
      const on = D.toggleWish(app);
      paintHeart();
      toast(on ? t('store.wishAdded') : t('store.wishRemoved'));
    });
    heart.classList.add('gs-heart');
    const paintHeart = () => {
      const on = D.isWished(app);
      heart.innerHTML = icon(on ? 'gsHeartFill' : 'gsHeart', 22);
      heart.classList.toggle('on', on);
      heart.title = on ? t('store.unwish') : t('store.wish');
      heart.setAttribute('aria-label', heart.title);
      heart.setAttribute('aria-pressed', String(on));
    };
    paintHeart();
    const more = iconBtn('more', (e) => menu(e.currentTarget, [
      D.isInstalled(app) ? { label: t('store.uninstall'), icon: 'trash', danger: true, onClick: () => uninstall(app) } : null,
      { label: t('common.openNewTab'), icon: 'tab', onClick: () => openUrl(app.url, { shiftKey: true }) },
      { label: t('store.copyLink'), icon: 'link', onClick: () => navigator.clipboard?.writeText(app.url).then(() => toast(t('store.linkCopied'))) },
    ], { align: 'end' }), t('common.more'));
    more.classList.add('gs-more-btn');

    ctx.push({
      title: app.name,
      hero: false,
      className: 'gs-page gs-detail',
      actions: [heart, more],
      render: (body, page) => {
        body.classList.add('gs-body');
        page.el.dataset.site = app.site;
        const hosts = D.installedHosts();
        const rank = M.catRank(app);
        const [about, details] = D.describe(app);
        const cat = M.CATS[app.cat];
        const stat = (value, caption) => h('div', { class: 'gs-stat' }, h('b', null, value), h('small', null, caption));
        const info = (label, value) => h('div', { class: 'gs-info-row' }, h('span', null, label), h('b', { dir: 'auto' }, value));
        body.append(
          h('div', { class: 'gs-hero' }, siteIcon(app, 96),
            h('div', { class: 'gs-hero-text' },
              h('h1', { class: 'gs-hero-name', dir: 'auto' }, app.name),
              h('a', { class: 'gs-hero-dev', href: app.url, dir: 'ltr', onClick: (e) => {
                e.preventDefault();
                openUrl(app.url, e);
              } }, app.host),
              h('button', { class: 'ou-chip gs-cat-chip', onClick: () => openCategory(app.cat) }, h('span', { html: icon(cat.icon, 16), style: { color: cat.color } }), D.catName(app.cat)))),
          h('div', { class: 'gs-stats' },
            stat('#' + rank, D.catName(app.cat)),
            stat('#' + M.overallRank(app), t('store.topSites')),
            stat(h('span', { class: 'gs-stat-ic', html: icon('globe', 22) }), h('bdi', null, app.host))),
          getBtn(app, { big: true, hosts }),
          section(t('store.about'), h('div', { class: 'ou-card gs-about' }, h('p', null, about), h('p', null, details))),
          section(t('store.alsoLike'), hrow(M.similar(app, 9), hosts), () => openCategory(app.cat)),
          section(t('store.info'), h('div', { class: 'ou-card gs-info' },
            info(t('store.website'), app.host),
            info(t('store.category'), D.catName(app.cat)),
            info(t('store.homeName'), app.label),
            info(t('store.chart'), t('store.rankIn', { n: rank, category: D.catName(app.cat) })))));
        // the app bar shows the name only once the big one has scrolled away
        page.scrollEl.addEventListener('scroll', () => page.el.classList.toggle('gs-scrolled', page.scrollEl.scrollTop > 90), { passive: true });
        return store.on('storeWish', paintHeart);
      },
    });
  }
  async function uninstall(app) {
    if (!(await confirm(app.label, t('store.uninstallQ'), { okLabel: t('store.uninstall'), danger: true }))) return;
    const undo = D.uninstall(app);
    refresh();
    toast(t('store.uninstalled', { name: app.label }), { action: t('common.undo'), onAction: () => undo() });
  }

  // ——— params: { section }, { site }, { cat }, { q } (Finder, the widget, #open=store&s=…) ———
  ctx.setParams = (p = {}) => {
    if (typeof p.q === 'string') query = p.q;
    const app = p.site && M.BY_SITE.get(p.site);
    const cat = p.cat && M.inCat(p.cat).length ? p.cat : null;
    const tab = TABS.some((x) => x.id === p.section) ? p.section : app ? 'discover' : cat ? 'categories' : typeof p.q === 'string' ? 'search' : null;
    if (tab) show(tab);
    if (app) openDetail(app);
    else if (cat) openCategory(cat);
  };
  ctx.setParams(ctx.params || {});
  if (!current) show('discover');

  const offs = [store.on('home', refresh), store.on('dock', refresh)];
  return () => offs.forEach((f) => f());
}

addStrings({
  en: {
    'store.tab.discover': 'Discover',
    'store.tab.categories': 'Categories',
    'store.tab.top': 'Top',
    'store.tab.search': 'Search',
    'store.tab.menu': 'Menu',
    'store.mustHave': 'Must-have websites',
    'store.popularIn': 'Popular in {category}',
    'store.topSites': 'Top websites',
    'store.viewAll': 'View all',
    'store.all': 'All',
    'store.categories': 'Categories',
    'store.websites': 'Websites',
    'store.count': 'Websites: {n}',
    'store.catSub': '{names} and more',
    'store.popular': 'Popular',
    'store.az': 'A–Z',
    'store.installedState': 'Installed',
    'store.searchPh': 'Search websites',
    'store.clear': 'Clear',
    'store.recent': 'Recent searches',
    'store.clearAll': 'Clear all',
    'store.popularSearches': 'Popular searches',
    'store.noResults': 'No results found',
    'store.addHost': 'Add {host} to Home screen',
    'store.address': 'Website address',
    'store.about': 'About this website',
    'store.alsoLike': 'You might also like',
    'store.info': 'Information',
    'store.website': 'Website',
    'store.category': 'Category',
    'store.homeName': 'Name on Home screen',
    'store.chart': 'Chart',
    'store.rankIn': 'Number {n} in {category}',
    'store.uninstall': 'Uninstall',
    'store.uninstallQ': 'Remove this website from your Home screen?',
    'store.uninstalled': '{name} uninstalled',
    'store.copyLink': 'Copy link',
    'store.linkCopied': 'Link copied',
    'store.wish': 'Add to Wish list',
    'store.unwish': 'Remove from Wish list',
    'store.wishAdded': 'Added to Wish list',
    'store.wishRemoved': 'Removed from Wish list',
    'store.wishList': 'Wish list',
    'store.wishEmpty': 'No websites in your Wish list',
    'store.myApps': 'My apps',
    'store.myAppsSub': 'Websites on your Home screen',
    'store.myAppsEmpty': 'No websites installed yet',
    'store.otherSites': 'Other websites',
    'store.clearHistory': 'Clear search history',
    'store.historyCleared': 'Search history cleared',
    'store.aboutStore': 'About Galaxy Store',
    'store.aboutText': 'Galaxy Store lists {n} popular websites in {c} categories. Install puts one on your Home screen, and Uninstall removes it.\n\nIcons come from Chrome’s own favicon cache, so nothing is looked up online.',
    'store.menuSub': 'Websites: {n} · Installed: {m}',
    'store.kick.social': 'Stay connected',
    'store.kick.entertainment': 'Tonight',
    'store.kick.productivity': 'Get things done',
    'store.kick.creativity': 'Make something',
    'store.kick.reading': 'Stay informed',
    'store.kick.shopping': 'Shop',
    'store.kick.travel': 'Get away',
    'store.kick.health': 'Feel better',
    'store.kick.education': 'Keep learning',
    'store.kick.games': 'Play',
    'store.kick.utilities': 'Handy tools',
    'store.banner.social': 'Everyone you talk to, in one place',
    'store.banner.entertainment': 'Something good to watch',
    'store.banner.productivity': 'Your workday, sorted',
    'store.banner.creativity': 'Tools for creators',
    'store.banner.reading': 'Catch up on the news',
    'store.banner.shopping': 'Delivered to your door',
    'store.banner.travel': 'Plan your next trip',
    'store.banner.health': 'Healthy habits',
    'store.banner.education': 'Learn something new',
    'store.banner.games': 'Games for a quick break',
    'store.banner.utilities': 'Little helpers for every day',
  },
  ar: {
    'store.tab.discover': 'اكتشاف',
    'store.tab.categories': 'الفئات',
    'store.tab.top': 'الأفضل',
    'store.tab.search': 'بحث',
    'store.tab.menu': 'القائمة',
    'store.mustHave': 'مواقع لا غنى عنها',
    'store.popularIn': 'الأكثر شعبية في {category}',
    'store.topSites': 'أشهر المواقع',
    'store.viewAll': 'عرض الكل',
    'store.all': 'الكل',
    'store.categories': 'الفئات',
    'store.websites': 'المواقع',
    'store.count': 'المواقع: {n}',
    'store.catSub': '{names} والمزيد',
    'store.popular': 'الأكثر شعبية',
    'store.az': 'أ–ي',
    'store.installedState': 'مثبّت',
    'store.searchPh': 'ابحث في المواقع',
    'store.clear': 'مسح',
    'store.recent': 'عمليات البحث الأخيرة',
    'store.clearAll': 'مسح الكل',
    'store.popularSearches': 'عمليات البحث الشائعة',
    'store.noResults': 'لم يتم العثور على نتائج',
    'store.addHost': 'إضافة {host} إلى الشاشة الرئيسية',
    'store.address': 'عنوان موقع ويب',
    'store.about': 'حول هذا الموقع',
    'store.alsoLike': 'قد يعجبك أيضًا',
    'store.info': 'معلومات',
    'store.website': 'موقع الويب',
    'store.category': 'الفئة',
    'store.homeName': 'الاسم على الشاشة الرئيسية',
    'store.chart': 'الترتيب',
    'store.rankIn': 'رقم {n} في {category}',
    'store.uninstall': 'إلغاء التثبيت',
    'store.uninstallQ': 'هل تريد إزالة هذا الموقع من الشاشة الرئيسية؟',
    'store.uninstalled': 'تم إلغاء تثبيت {name}',
    'store.copyLink': 'نسخ الرابط',
    'store.linkCopied': 'تم نسخ الرابط',
    'store.wish': 'إضافة إلى قائمة الأمنيات',
    'store.unwish': 'إزالة من قائمة الأمنيات',
    'store.wishAdded': 'تمت الإضافة إلى قائمة الأمنيات',
    'store.wishRemoved': 'تمت الإزالة من قائمة الأمنيات',
    'store.wishList': 'قائمة الأمنيات',
    'store.wishEmpty': 'لا توجد مواقع في قائمة الأمنيات',
    'store.myApps': 'تطبيقاتي',
    'store.myAppsSub': 'المواقع على شاشتك الرئيسية',
    'store.myAppsEmpty': 'لم يتم تثبيت أي موقع بعد',
    'store.otherSites': 'مواقع أخرى',
    'store.clearHistory': 'مسح سجل البحث',
    'store.historyCleared': 'تم مسح سجل البحث',
    'store.aboutStore': 'حول متجر Galaxy',
    'store.aboutText': 'يعرض متجر Galaxy {n} موقعًا شائعًا في {c} فئة. يضع التثبيت الموقع على شاشتك الرئيسية، ويزيله إلغاء التثبيت.\n\nتأتي الأيقونات من ذاكرة Chrome المؤقتة للأيقونات، فلا يتم البحث عن أي شيء عبر الإنترنت.',
    'store.menuSub': 'المواقع: {n} · المثبّتة: {m}',
    'store.kick.social': 'ابقَ على تواصل',
    'store.kick.entertainment': 'الليلة',
    'store.kick.productivity': 'أنجِز مهامك',
    'store.kick.creativity': 'اصنع شيئًا',
    'store.kick.reading': 'ابقَ على اطّلاع',
    'store.kick.shopping': 'تسوّق',
    'store.kick.travel': 'انطلق',
    'store.kick.health': 'اعتنِ بنفسك',
    'store.kick.education': 'واصل التعلّم',
    'store.kick.games': 'العب',
    'store.kick.utilities': 'أدوات مفيدة',
    'store.banner.social': 'كل من تتحدث إليهم في مكان واحد',
    'store.banner.entertainment': 'شيء رائع للمشاهدة',
    'store.banner.productivity': 'يوم عملك منظَّم',
    'store.banner.creativity': 'أدوات للمبدعين',
    'store.banner.reading': 'تابِع آخر الأخبار',
    'store.banner.shopping': 'يصلك حتى بابك',
    'store.banner.travel': 'خطِّط لرحلتك القادمة',
    'store.banner.health': 'عادات صحية',
    'store.banner.education': 'تعلّم شيئًا جديدًا',
    'store.banner.games': 'ألعاب لاستراحة قصيرة',
    'store.banner.utilities': 'أدوات صغيرة تساعدك كل يوم',
  },
});
