// Galaxy Store for websites — registration only (it loads at every new tab): the app, its Finder results ("netflix"
// offers Install Netflix), the Today's pick widget and the glyphs it uses. The screens live in js/store/ui.js and the
// catalog in js/store/, both loaded the first time something needs them.
import { h, everyMinute } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { store } from '../core/store.js';
import { addStrings, t } from '../core/i18n.js';
import { registerAction, RunError, toText } from '../routines/actions.js';

addIcons({
  gsBag: '<path d="M5.2 8.2h13.6l-1 11.1a1.7 1.7 0 0 1-1.7 1.5H7.9a1.7 1.7 0 0 1-1.7-1.5l-1-11.1Z"/><path d="M8.8 8.2V7a3.2 3.2 0 0 1 6.4 0v1.2"/><path d="M9.2 13.1a3.1 3.1 0 0 0 5.6 0"/>',
  gsCompass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1Z"/>',
  gsChart: '<path d="M4.5 19.5h15"/><rect x="5.5" y="11" width="3" height="6" rx="1"/><rect x="10.5" y="5.5" width="3" height="11.5" rx="1"/><rect x="15.5" y="8.5" width="3" height="8.5" rx="1"/>',
  gsMenu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
  gsChat: '<path d="M12 4.5c4.4 0 8 3 8 6.8s-3.6 6.8-8 6.8c-1 0-2-.1-2.9-.4L5 19.5l1.2-3.6C4.8 14.7 4 13.1 4 11.3 4 7.5 7.6 4.5 12 4.5Z"/>',
  gsPlay: '<rect x="3.5" y="5" width="17" height="12.5" rx="3"/><path d="M10.5 8.9v5.2l4.2-2.6-4.2-2.6Z"/><path d="M8.5 20.5h7"/>',
  gsWork: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17"/>',
  gsBook: '<path d="M12 6.5c-1.8-1.3-4.3-2-7.5-2v13c3.2 0 5.7.7 7.5 2 1.8-1.3 4.3-2 7.5-2v-13c-3.2 0-5.7.7-7.5 2Z"/><path d="M12 6.5v13"/>',
  gsCart: '<path d="M3.5 4.5h2l2 10.5h10l2-7.5H7"/><circle cx="9" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/>',
  gsHeart: '<path d="M12 19.5s-7.5-4.4-7.5-9.8A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.4c0 5.4-7.5 9.8-7.5 9.8Z"/>',
  gsHeartFill: '<path d="M12 19.5s-7.5-4.4-7.5-9.8A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.4c0 5.4-7.5 9.8-7.5 9.8Z" fill="currentColor"/>',
  gsCap: '<path d="m2.5 9.5 9.5-4.5 9.5 4.5-9.5 4.5-9.5-4.5Z"/><path d="M6.5 11.5V16c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2v-4.5M21.5 9.5v5"/>',
  gsGame: '<path d="M7.5 7.5h9a4.5 4.5 0 0 1 4.3 5.8l-1.1 3.6a2 2 0 0 1-3.4.7l-1.8-2.1h-5l-1.8 2.1a2 2 0 0 1-3.4-.7l-1.1-3.6A4.5 4.5 0 0 1 7.5 7.5Z"/><path d="M8 10.5v3M6.5 12h3"/><circle cx="16" cy="11" r=".7" fill="currentColor"/><circle cx="17.6" cy="13" r=".7" fill="currentColor"/>',
  gsTool: '<path d="M14.6 4.3a4.5 4.5 0 0 0-5 6l-5.3 5.3a1.8 1.8 0 0 0 2.5 2.5l5.3-5.3a4.5 4.5 0 0 0 6-5l-2.6 2.6-2.4-.6-.6-2.4 2.1-3.1Z"/>',
});

const ICON_BG = 'linear-gradient(150deg, #ff6b93 0%, #ec2f6c 52%, #c0258f 100%)';
const data = () => import('../store/data.js');
const openStore = (params, from) => openApp('store', { from, params });

registerApp({
  id: 'store',
  name: 'app.store',
  icon: { bg: ICON_BG, glyph: '<path d="M5.2 8.2h13.6l-1 11.1a1.7 1.7 0 0 1-1.7 1.5H7.9a1.7 1.7 0 0 1-1.7-1.5l-1-11.1Z"/><path d="M8.8 8.2V7a3.2 3.2 0 0 1 6.4 0v1.2"/><path d="M9.2 13.1a3.1 3.1 0 0 0 5.6 0" stroke-width="2.1"/>' },
  keywords: ['galaxy store', 'store', 'app store', 'install', 'websites', 'متجر', 'تثبيت', 'مواقع'],
  render: (ctx) => import('../store/ui.js').then((m) => m.render(ctx)),
  async search(q) {
    if (q.trim().length < 2) return [];
    return (await data()).finderResults(q.trim(), (p) => openStore(p));
  },
});

// Today's pick: the site of the day (it changes at midnight), Install/Open right on the widget.
registerWidget({
  id: 'store-pick',
  name: 'store.widget',
  sizes: ['s', 'm'],
  defaultSize: 's',
  app: 'store',
  onClick: (item, el) => import('../store/model.js').then((M) => openStore({ site: M.pickOfDay().site }, el)),
  render(el, { size }) {
    el.classList.add('wg-store');
    let dead = false, off = [], day = null;
    Promise.all([data(), import('../store/model.js'), import('../store/icon.js')]).then(([D, M, I]) => {
      if (dead) return;
      const draw = () => {
        day = M.dayNumber();
        const app = M.pickOfDay(day);
        const inst = D.isInstalled(app);
        const btn = h('button', {
          class: ['wg-store-btn', inst && 'open'],
          onClick: (e) => {
            e.stopPropagation();
            if (D.isInstalled(app)) import('../shell/appicon.js').then((m) => m.openUrl(app.url, e));
            else D.install(app);
          },
        }, inst ? t('store.open') : t('store.install'));
        el.style.setProperty('--h', I.hueOf(app));
        el.replaceChildren(
          h('div', { class: 'wg-head wg-store-head' }, h('span', { class: 'wg-store-logo', style: { background: ICON_BG }, html: icon('gsBag', 12) }), h('span', null, t('store.widget'))),
          h('div', { class: 'wg-store-main' },
            I.siteIcon(app, 60),
            h('div', { class: 'wg-store-text' },
              h('div', { class: 'wg-store-name', dir: 'auto' }, app.label),
              h('div', { class: 'wg-store-cat' }, D.catName(app.cat)),
              size === 'm' ? h('div', { class: 'wg-store-desc' }, D.describe(app)[0]) : null),
            size === 'm' ? btn : null),
          ...(size === 'm' ? [] : [btn]));
      };
      draw();
      off = [store.on('home', draw), store.on('dock', draw), everyMinute(() => day !== M.dayNumber() && draw())];
    });
    return () => {
      dead = true;
      off.forEach((f) => f());
    };
  },
});

// ——— Routines: "Open Galaxy Store" (a site's page when the text names one, else a search; empty: Discover) ———
registerAction({
  id: 'store.open', name: 'store.ra.open', icon: 'gsBag', color: '#ec2f6c', cat: 'apps',
  params: [{ key: 'q', type: 'text', label: 'store.ra.q', ph: 'store.ra.qPh' }],
  sub: (p, F) => F.text(p.q),
  async run(ctx, p) {
    if (!ctx.page) throw new RunError('routines.err.page');
    const q = toText(p.q ?? '').trim();
    if (!q) return void openStore({ section: 'discover' });
    const M = await import('../store/model.js');
    const app = M.appForHost(q.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '')) || M.searchApps(q, { limit: 1, min: 1000 })[0];
    openStore(app ? { site: app.site } : { section: 'search', q });
  },
});

addStrings({
  en: {
    'app.store': 'Galaxy Store',
    'store.widget': 'Today’s pick',
    'store.ra.open': 'Open Galaxy Store',
    'store.ra.q': 'Website or search',
    'store.ra.qPh': 'Leave empty for Discover',
  },
  ar: {
    'app.store': 'متجر Galaxy',
    'store.widget': 'اختيار اليوم',
    'store.ra.open': 'فتح متجر Galaxy',
    'store.ra.q': 'موقع ويب أو بحث',
    'store.ra.qPh': 'اتركه فارغًا لعرض اكتشاف',
  },
});
