// What's new: a One UI dialog listing what this version brought, shown once to people updating from an older version
// (settings.seenVersion differs from the manifest's version) after they unlock. New users finish the welcome tour on
// the current version instead (onboarding.js sets seenVersion), so they never see it. Settings › About › What's new
// opens it any time. main.js loads this module only when the version changed.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, addStrings } from '../core/i18n.js';
import { setting, setSetting } from '../core/store.js';
import { dialog } from '../core/ui.js';
import { getApp, appIconEl, appName, openApp } from '../core/apps.js';

// One row per feature marked done in CLAUDE.md › Roadmap. App rows show only when the app is installed (registered)
// and open it; add a row here when a Roadmap item lands.
const FEATURES = [
  { app: 'health', sub: 'wn.health' },
  { app: 'wallet', sub: 'wn.wallet' },
  { app: 'contacts', sub: 'wn.contacts' },
  { app: 'games', sub: 'wn.games' },
  { app: 'recorder', sub: 'wn.recorder' },
  { app: 'interpreter', sub: 'wn.interpreter' },
  { app: 'routines', sub: 'wn.routines' },
  { app: 'journal', sub: 'wn.journal' },
  { app: 'store', sub: 'wn.store' },
  { app: 'wellbeing', sub: 'wn.wellbeing' },
  { app: 'music', sub: 'wn.music' },
  { app: 'canvas', sub: 'wn.canvas' },
  { app: 'files', sub: 'wn.files' },
  { app: 'notes', sub: 'wn.notes' },
  { app: 'calendar', sub: 'wn.calendar' },
  { app: 'clock', sub: 'wn.clock' },
  { app: 'weather', sub: 'wn.weather' },
  { id: 'windows', icon: 'layout', color: 'linear-gradient(145deg, #5b8cff, #3a5bd9)', title: 'wn.windows', sub: 'wn.windowsSub', open: () => import('./recents.js').then((m) => m.openRecents()) },
  { id: 'pin', icon: 'lock', color: 'linear-gradient(145deg, #2fbf8f, #14866a)', title: 'wn.pin', sub: 'wn.pinSub', open: () => openApp('settings', { params: { page: 'lock' } }) },
  { id: 'dailyboard', icon: 'dailyBoard', color: 'linear-gradient(145deg, #3a3f5c, #11131c)', title: 'wn.dailyBoard', sub: 'wn.dailyBoardSub', open: () => import('./dailyboard.js').then((m) => m.openDailyBoard()) },
];

const version = () => globalThis.chrome?.runtime?.getManifest?.().version || '';
let showing = null;

/** The rows that apply on this install (apps that aren't registered are left out). */
export const whatsNewItems = () => FEATURES.filter((f) => !f.app || getApp(f.app));

/** Opens the sheet. Resolves when it closes. */
export function showWhatsNew() {
  if (showing) return showing;
  let close;
  const rows = whatsNewItems().map((f) => {
    const app = f.app && getApp(f.app);
    return h('button', {
      class: 'wn-row',
      dataset: { feature: f.app || f.id },
      onClick: () => {
        close?.();
        // let the dialog leave first, so the app opens on a clear screen
        setTimeout(() => (app ? openApp(f.app) : f.open?.()), 240);
      },
    },
      app ? appIconEl(app, 44) : h('span', { class: 'wn-ico', style: { '--c': f.color }, html: icon(f.icon, 24) }),
      h('span', { class: 'wn-text' }, h('b', null, app ? appName(app) : t(f.title)), h('span', null, t(f.sub))));
  });
  const v = version();
  const content = h('div', { class: 'wn' }, v ? h('div', { class: 'wn-ver' }, t('wn.version', { v })) : null, h('div', { class: 'wn-list' }, rows));
  showing = dialog({ title: t('wn.title'), content, className: 'wn-dialog', actions: [{ label: t('wn.ok'), value: true, primary: true }] })
    .finally(() => (showing = null));
  close = () => content.closest('.ou-dialog')?._close(null);
  return showing;
}

/**
 * After an update: shows the sheet once, when the screen is unlocked (never over the Lock screen or the welcome tour).
 * Under automation it stays away unless a test sets localStorage `bt.test.whatsnew`.
 */
export function autoWhatsNew() {
  if (navigator.webdriver && !localStorage.getItem('bt.test.whatsnew')) return;
  const due = () => setting('onboarded') === true && version() && setting('seenVersion') !== version();
  if (!due()) return;
  const blocked = () => document.body.classList.contains('locked') || document.documentElement.classList.contains('onb-pending') || document.querySelector('.db');
  const go = () => {
    // another tab may have shown it while this one waited
    if (!due()) return;
    setSetting('seenVersion', version());
    showWhatsNew();
  };
  if (!blocked()) return void setTimeout(go, 500);
  const mo = new MutationObserver(() => {
    if (blocked()) return;
    mo.disconnect();
    setTimeout(go, 500);
  });
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

addStrings({
  en: {
    'wn.title': 'What’s new in Bloom Tab',
    'wn.version': 'Version {v}',
    'wn.ok': 'OK',
    'wn.wallet': 'Passes with real barcodes, alerts before bills and subscriptions renew, and your spending.',
    'wn.contacts': 'Your contacts with groups, favourites, birthdays and vCard import and export.',
    'wn.games': 'Sudoku, Minesweeper, Solitaire, Chess and 2048, with new daily puzzles and achievements.',
    'wn.recorder': 'Record with a live waveform, bookmarks, Interview mode and speech-to-text on this device.',
    'wn.interpreter': 'Translate text and conversations on this device, even offline.',
    'wn.routines': 'Modes like Sleep and Work, and If/Then routines for everything in Bloom Tab.',
    'wn.journal': 'Write about your day with photos and moods, and see your streaks and insights.',
    'wn.store': 'Discover websites by category and chart, and install them on your Home screen.',
    'wn.wellbeing': 'Screen time, site timers, Focus modes and Bedtime mode.',
    'wn.dailyBoard': 'Daily Board',
    'wn.dailyBoardSub': 'Your photos, a big clock, your calendar and widgets while you’re away. Open it from the Quick panel.',
    'wn.health': 'Activity rings, medications with reminders, water, sleep, mood and cycle tracking.',
    'wn.music': 'Play your own music files, with lyrics, playlists and an equaliser. It keeps playing after the tab closes.',
    'wn.canvas': 'An endless board for sticky notes, shapes, drawings, pictures and links.',
    'wn.files': 'Your downloads by category, with recent files and a Recycle bin.',
    'wn.notes': 'Folders, tags, pictures, drawings, tables, locked notes and Writing assist.',
    'wn.calendar': 'Year, week and day views, repeating events, calendar subscriptions and the Hijri calendar.',
    'wn.clock': 'Alarms that ring even with no tab open, a world map and several timers at once.',
    'wn.weather': 'Several cities, detail cards for every condition, and rain alerts.',
    'wn.windows': 'Multi window',
    'wn.windowsSub': 'Open several apps at once, side by side in split screen, and switch between them in Recents.',
    'wn.pin': 'Screen lock PIN',
    'wn.pinSub': 'Protect your apps and new tabs with a PIN. Set it up in Settings › Lock screen.',
  },
  ar: {
    'wn.title': 'الجديد في Bloom Tab',
    'wn.version': 'الإصدار {v}',
    'wn.ok': 'موافق',
    'wn.wallet': 'بطاقات برموز شريطية حقيقية، وتنبيهات قبل تجديد الفواتير والاشتراكات، ومصروفاتك.',
    'wn.contacts': 'جهات اتصالك مع المجموعات والمفضلة وأعياد الميلاد واستيراد vCard وتصديرها.',
    'wn.games': 'سودوكو وكاسحة الألغام والسوليتير والشطرنج و2048، مع ألغاز يومية جديدة وإنجازات.',
    'wn.recorder': 'سجّل مع موجة صوتية مباشرة وإشارات مرجعية ووضع المقابلة وتحويل الكلام إلى نص على هذا الجهاز.',
    'wn.interpreter': 'ترجم النصوص والمحادثات على هذا الجهاز، حتى دون اتصال.',
    'wn.routines': 'أوضاع مثل النوم والعمل، وإجراءات روتينية «إذا/ثم» لكل شيء في Bloom Tab.',
    'wn.journal': 'اكتب عن يومك مع الصور والحالة المزاجية، وتابع سلاسلك ورؤاك.',
    'wn.store': 'اكتشف المواقع حسب الفئة والتصنيف، وثبّتها على الشاشة الرئيسية.',
    'wn.wellbeing': 'وقت الشاشة ومؤقتات المواقع وأوضاع التركيز ووضع وقت النوم.',
    'wn.dailyBoard': 'اللوحة اليومية',
    'wn.dailyBoardSub': 'صورك وساعة كبيرة وتقويمك وأدواتك أثناء غيابك. افتحها من اللوحة السريعة.',
    'wn.health': 'حلقات النشاط، والأدوية مع التذكيرات، والماء، والنوم، والحالة المزاجية، وتتبع الدورة.',
    'wn.music': 'شغّل ملفات الموسيقى الخاصة بك مع الكلمات وقوائم التشغيل والمعادل الصوتي. وتستمر في العمل بعد إغلاق التبويب.',
    'wn.canvas': 'لوحة لا نهائية للملاحظات اللاصقة والأشكال والرسومات والصور والروابط.',
    'wn.files': 'تنزيلاتك حسب الفئة، مع الملفات الأخيرة وسلة المحذوفات.',
    'wn.notes': 'مجلدات ووسوم وصور ورسومات وجداول وملاحظات مقفلة ومساعد الكتابة.',
    'wn.calendar': 'عرض السنة والأسبوع واليوم، والأحداث المتكررة، والاشتراك في التقاويم، والتقويم الهجري.',
    'wn.clock': 'منبهات ترن حتى دون أي تبويب مفتوح، وخريطة للعالم، وعدة مؤقتات في وقت واحد.',
    'wn.weather': 'عدة مدن، وبطاقات تفاصيل لكل حالة، وتنبيهات المطر.',
    'wn.windows': 'النوافذ المتعددة',
    'wn.windowsSub': 'افتح عدة تطبيقات معًا، جنبًا إلى جنب في تقسيم الشاشة، وتنقّل بينها من التطبيقات الأخيرة.',
    'wn.pin': 'رمز PIN لقفل الشاشة',
    'wn.pinSub': 'احمِ تطبيقاتك وتبويباتك الجديدة برمز PIN. اضبطه من الإعدادات › شاشة القفل.',
  },
});
