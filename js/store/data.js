// Galaxy Store for websites: what the screens, the widget and Finder share. Category names and the generated
// descriptions (translated), whether a site is installed (a site with the same host is on the Home screen), Install
// (home.js addSite with the short name), Uninstall, the Wish list (store key `storeWish`) and recent searches
// (`storeRecent`). Loaded lazily, the first time the store, its widget or a Finder search needs it.
import { hostname } from '../core/util.js';
import { store } from '../core/store.js';
import { t, addStrings } from '../core/i18n.js';
import { toast } from '../core/ui.js';
import { allItems, addSite, removeSite } from '../shell/home.js';
import { openUrl } from '../shell/appicon.js';
import { CATS, BY_SITE, catRank, searchApps, appForHost } from './model.js';

/** Left-to-right isolate, so a host or a Latin name keeps its order inside Arabic text. */
export const ltr = (s) => '⁦' + s + '⁩';
export const catName = (id) => t('store.cat.' + (CATS[id] ? id : 'other'));

/** Two short paragraphs built from the catalog: what the site is for, then its chart position and what Install does. */
export function describe(app) {
  const name = ltr(app.name);
  return [
    t('store.desc.' + app.cat, { name }),
    t('store.descRank', { rank: catRank(app), category: catName(app.cat) }) + ' ' + t('store.descInstall', { host: ltr(app.host), label: ltr(app.label) }),
  ];
}

// ——— installed = on the Home screen ———

const hostOf = (url) => hostname(url).toLowerCase();
/** Hosts of every website on the Home screen (pages, folders and the dock). */
export const installedHosts = () => new Set(allItems().filter((it) => it.type === 'site').map((it) => hostOf(it.url)));
export const isInstalled = (app, hosts = installedHosts()) => hosts.has(app.host);
/** Home screen websites the catalog doesn't list (they show under My apps › Other websites). */
export const otherHomeSites = () => allItems().filter((it) => it.type === 'site' && !appForHost(hostOf(it.url)));

/** Puts the site on the Home screen under its short name. Returns the new Home item. */
export function install(app, { quiet = false } = {}) {
  const item = addSite(app.url, app.label);
  if (!quiet) toast(t('store.installed', { name: app.label }), { action: t('store.open'), onAction: () => openUrl(app.url) });
  return item;
}

// Uninstall: home.js removes every website with the app's host (pages, folders, the dock; a folder left with one item
// becomes that item, as when you remove one by hand). Returns an undo function.
export const uninstall = (app) => removeSite(app.host);

// ——— Wish list and recent searches ———

export const wishList = () => (store.get('storeWish') || []).filter((s) => BY_SITE.has(s));
export const isWished = (app) => wishList().includes(app.site);
export function toggleWish(app) {
  const on = !isWished(app);
  store.set('storeWish', on ? [app.site, ...wishList()] : wishList().filter((s) => s !== app.site));
  return on;
}
export const recentSearches = () => store.get('storeRecent') || [];
export function addRecent(q) {
  q = String(q || '').trim();
  if (q.length < 2) return;
  store.set('storeRecent', [q, ...recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8));
}
export const removeRecent = (q) => store.set('storeRecent', recentSearches().filter((x) => x !== q));
export const clearRecent = () => store.set('storeRecent', []);

// ——— Finder: typing "netflix" offers Install ———

export function finderResults(q, openStore) {
  const hits = searchApps(q, { limit: 8, min: 400 });
  if (!hits.length) return [];
  const hosts = installedHosts();
  const out = hits.filter((a) => !isInstalled(a, hosts)).slice(0, 3).map((a) => ({
    title: t('store.installName', { name: a.label }),
    sub: `${catName(a.cat)} · ${ltr(a.host)}`,
    onOpen: () => install(a),
  }));
  out.push({ title: t('store.searchFor', { q: q.length > 40 ? q.slice(0, 40) + '…' : q }), sub: t('app.store'), onOpen: () => openStore({ section: 'search', q }) });
  return out;
}

addStrings({
  en: {
    'store.install': 'Install',
    'store.open': 'Open',
    'store.installed': '{name} added to Home screen',
    'store.installName': 'Install {name}',
    'store.searchFor': 'Search Galaxy Store for “{q}”',
    'store.cat.social': 'Social',
    'store.cat.entertainment': 'Entertainment',
    'store.cat.productivity': 'Productivity and finance',
    'store.cat.creativity': 'Creativity',
    'store.cat.reading': 'News and reading',
    'store.cat.shopping': 'Shopping and food',
    'store.cat.travel': 'Travel and local',
    'store.cat.health': 'Health and fitness',
    'store.cat.education': 'Education',
    'store.cat.games': 'Games',
    'store.cat.utilities': 'Tools',
    'store.cat.other': 'Other',
    'store.desc.social': '{name} keeps you close to friends, family and the communities you care about.',
    'store.desc.entertainment': 'Watch, listen and stream on {name} whenever you have a moment.',
    'store.desc.productivity': '{name} helps you get work done, from mail and documents to money and meetings.',
    'store.desc.creativity': 'Design, edit and share your ideas with {name}.',
    'store.desc.reading': 'Catch up on news, stories and answers on {name}.',
    'store.desc.shopping': 'Shop, order and track your deliveries on {name}.',
    'store.desc.travel': 'Find your way, book trips and get around with {name}.',
    'store.desc.health': 'Build healthy habits and keep track of your progress with {name}.',
    'store.desc.education': 'Learn at your own pace with {name}.',
    'store.desc.games': 'Jump into {name} for a quick game, or settle in for a longer one.',
    'store.desc.utilities': '{name} is a handy tool to keep close at hand.',
    'store.desc.other': '{name} is a website.',
    'store.descRank': 'Number {rank} in {category} on Galaxy Store.',
    'store.descInstall': 'Install adds {host} to your Home screen as “{label}”. It opens in Chrome, with nothing to download.',
  },
  ar: {
    'store.install': 'تثبيت',
    'store.open': 'فتح',
    'store.installed': 'تمت إضافة {name} إلى الشاشة الرئيسية',
    'store.installName': 'تثبيت {name}',
    'store.searchFor': 'البحث في متجر Galaxy عن “{q}”',
    'store.cat.social': 'التواصل الاجتماعي',
    'store.cat.entertainment': 'الترفيه',
    'store.cat.productivity': 'الإنتاجية والمالية',
    'store.cat.creativity': 'الإبداع',
    'store.cat.reading': 'الأخبار والقراءة',
    'store.cat.shopping': 'التسوق والطعام',
    'store.cat.travel': 'السفر والأماكن المحلية',
    'store.cat.health': 'الصحة واللياقة البدنية',
    'store.cat.education': 'التعليم',
    'store.cat.games': 'الألعاب',
    'store.cat.utilities': 'الأدوات',
    'store.cat.other': 'أخرى',
    'store.desc.social': 'يبقيك {name} قريبًا من الأصدقاء والعائلة والمجتمعات التي تهمك.',
    'store.desc.entertainment': 'شاهِد واستمع وتابِع البث على {name} متى سنحت لك الفرصة.',
    'store.desc.productivity': 'يساعدك {name} على إنجاز عملك، من البريد والمستندات إلى المال والاجتماعات.',
    'store.desc.creativity': 'صمِّم وعدِّل وشارِك أفكارك باستخدام {name}.',
    'store.desc.reading': 'تابِع الأخبار والقصص والإجابات على {name}.',
    'store.desc.shopping': 'تسوّق واطلب وتتبّع شحناتك على {name}.',
    'store.desc.travel': 'اعثر على طريقك واحجز رحلاتك وتنقّل مع {name}.',
    'store.desc.health': 'اكتسب عادات صحية وتابِع تقدّمك مع {name}.',
    'store.desc.education': 'تعلّم بالسرعة التي تناسبك مع {name}.',
    'store.desc.games': 'ادخل إلى {name} للعب جولة سريعة أو جلسة أطول.',
    'store.desc.utilities': '{name} أداة مفيدة يحسن أن تبقى في متناول يدك.',
    'store.desc.other': '{name} موقع ويب.',
    'store.descRank': 'رقم {rank} في فئة {category} على متجر Galaxy.',
    'store.descInstall': 'يضيف التثبيت {host} إلى شاشتك الرئيسية باسم “{label}”. يُفتح في Chrome دون تنزيل أي شيء.',
  },
});
