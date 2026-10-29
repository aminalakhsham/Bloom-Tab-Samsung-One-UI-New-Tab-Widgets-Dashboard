// Settings › Wallpaper and style (One UI): Lock and Home screen previews, Change wallpapers (your photos with Dynamic
// Lock screen, Creative wallpapers, the bloom collection, colours, picture of the day), Color palette, dimming and
// blur. Loaded when the page opens (js/apps/settings.js keeps only the stubs).
import { h, pickFile } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t, addStrings, fmtHM, fmtDate, fmtPeriod } from '../core/i18n.js';
import { store, setting, setSetting, onSetting } from '../core/store.js';
import { row, switchRow, list, subheader, choose, dialog, toast, slider, seg, card, btn, confirm } from '../core/ui.js';
import * as W from '../shell/wallpaper.js';
import { toAccent } from '../shell/theme.js';
import { hexToRgb, rgbToHsl, hslToRgb, rgbToHex } from '../core/util.js';

addIcons({
  wpShuffle: '<path d="M3.5 7h3.2c2 0 3.3 1 4.3 2.6l2 3.3c1 1.6 2.3 2.6 4.3 2.6h3.2M3.5 17h3.2c1.4 0 2.4-.5 3.2-1.3M14.1 8.3c.8-.8 1.8-1.3 3.1-1.3h3.3M18 4.5 20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5"/>',
  wpWand: '<path d="m4 20 11-11M13.5 7.5l3 3"/><path d="M17.5 3v3M16 4.5h3M20 9v2.4M18.8 10.2h2.4M9.5 3.5v2M8.5 4.5h2" stroke-width="1.6"/>',
  wpHalf: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor"/>',
});

const BASIC = ['#3e7bff', '#6c5ce7', '#e0567f', '#ff7a2f', '#f5b400', '#22b07d', '#00a6c8', '#7a8699'];

/** One UI's "Set as wallpaper" question. Resolves 'both' | 'home' | 'lock' | null. */
export async function askWhere(defaultWhere = 'both') {
  return choose(t('set.wp.setOn'), [
    { value: 'both', label: t('set.wp.both') },
    { value: 'home', label: t('set.homeScreen') },
    { value: 'lock', label: t('set.lockScreen') },
  ], defaultWhere);
}
async function apply(wp) {
  const where = await askWhere();
  if (!where) return false;
  W.setWallpaper(wp, where);
  toast(t('set.wallpaperSet'));
  return true;
}

/** A phone-shaped preview of the Lock screen (clock) or the Home screen (icons and dock). */
function phone(kind, wp) {
  const box = W.thumbInto(h('div', { class: ['set-wall-thumb', 'swp-phone'] }), wp, 120, 250);
  const now = new Date();
  if (kind === 'lock') {
    const [hh, mm] = fmtHM(now).split(':');
    box.append(h('div', { class: 'swp-lock' }, h('small', null, fmtDate(now, { weekday: 'short', day: 'numeric', month: 'short' })), h('b', null, hh), h('b', null, mm), fmtPeriod(now) ? h('small', null, fmtPeriod(now)) : null));
  } else box.append(h('div', { class: 'swp-home' }, h('i', { class: 'swp-w' }), ...Array.from({ length: 8 }, () => h('i')), h('span', { class: 'swp-dock' }, h('i'), h('i'), h('i'), h('i'))));
  if (wp.type === 'shuffle') box.append(h('span', { class: 'swp-badge', html: icon('wpShuffle', 16) }));
  return box;
}

// ——— the page ———
export function wallpaperPage(body, ctx, page, { openSection } = {}) {
  const previews = h('div', { class: 'set-wall-previews' });
  const drawPreviews = () => {
    const pv = (kind) => h('button', {
      class: 'swp', 'aria-label': t(kind === 'lock' ? 'set.lockScreen' : 'set.homeScreen'),
      onClick: () => openSection?.(kind),
    }, phone(kind, kind === 'lock' ? W.lockWall() : W.homeWall()), h('span', null, t(kind === 'lock' ? 'set.lockScreen' : 'set.homeScreen')));
    previews.replaceChildren(pv('lock'), pv('home'));
  };
  drawPreviews();

  const palRow = row({ icon: 'palette', iconBg: '#e0567f', title: t('set.palette'), sub: paletteLabel(), chevron: true, className: 'muted-sub', onClick: () => palettePage(ctx) });
  const drawPal = () => (palRow.querySelector('.ou-row-sub').textContent = paletteLabel());
  const dynRow = switchRow({ title: t('set.wp.dynamic'), sub: t('set.wp.dynamicSub'), checked: W.lockWall().type === 'shuffle', onChange: (on) => setDynamic(on, dynRow) });
  const darkDim = switchRow({ title: t('set.wp.darkDim'), sub: t('set.wp.darkDimSub'), checked: !!setting('wallpaperDarkDim'), onChange: (v) => setSetting('wallpaperDarkDim', v) });
  const dim = dimSlider();
  body.append(
    card(previews, h('div', { class: 'set-wall-change' }, btn(t('set.wp.change'), () => galleryPage(ctx), 'tonal set-wp-change'))),
    list(palRow),
    list(dynRow),
    list(
      switchRow({ title: t('set.live'), sub: t('set.liveSub'), checked: !!setting('wallpaperAnimated'), onChange: (v) => setSetting('wallpaperAnimated', v) }),
      darkDim,
      switchRow({ title: t('set.blurHome'), sub: t('set.blurHomeSub'), checked: !!setting('wallpaperBlurHome'), onChange: (v) => setSetting('wallpaperBlurHome', v) }),
      dim));
  drawPal();
  const offs = [
    onSetting('wallpaper', drawPreviews), onSetting('lockWallpaper', () => { drawPreviews(); dynRow.querySelector('input').checked = W.lockWall().type === 'shuffle'; }),
    onSetting('accent', drawPal), W.onWallColors(drawPal), store.on('wallPhotos', drawPreviews),
  ];
  return () => offs.forEach((f) => f());
}

function dimSlider() {
  const val = h('span', { class: 'set-slider-val' }, (setting('wallpaperDim') || 0) + '%');
  const s = slider({ min: 0, max: 60, step: 5, value: setting('wallpaperDim') || 0, icon: 'moon', label: t('set.dim'), onInput: (v) => { val.textContent = v + '%'; setSetting('wallpaperDim', v); } });
  s.classList.add('set-slider');
  return h('div', { class: 'ou-row set-slider-row' }, h('div', { class: 'set-slider-head' }, h('span', { class: 'ou-row-title' }, t('set.dim')), val), s);
}

async function setDynamic(on, r) {
  const sw = r?.querySelector('input');
  if (!on) {
    setSetting('lockWallpaper', null);
    return;
  }
  if (W.photos().length < 2) {
    if (sw) sw.checked = false;
    toast(t('set.wp.needTwo'));
    const files = await pickFile('image/*', true);
    if (!files?.length) return;
    await W.addPhotos(files);
    if (W.photos().length < 2) return;
  }
  W.setWallpaper({ type: 'shuffle' }, 'lock');
  if (sw) sw.checked = true;
  toast(t('set.wp.dynamicOn'));
}

function paletteLabel() {
  const a = setting('accent');
  if (!a || a === 'auto' || String(a).startsWith('wall:')) return t('set.pal.fromWall');
  return t('set.pal.basic');
}

// ——— Change wallpapers ———
function galleryPage(ctx) {
  ctx.push({
    title: t('set.wallpapers'),
    className: 'set-gallery',
    render(body) {
      const photosBox = h('div', { class: 'set-wall-grid set-photos' });
      const photosCard = card(photosBox);
      const drawPhotos = () => {
        const ids = W.photos();
        const items = [
          h('button', { class: 'set-wall-item set-wall-add', title: t('set.fromPhotos'), onClick: () => addPhotosFlow() },
            h('div', { class: 'set-wall-thumb', html: icon('plus', 28) }), h('span', null, t('set.wp.add'))),
        ];
        if (ids.length > 1) {
          const wp = { type: 'shuffle' };
          const on = W.lockWall().type === 'shuffle';
          items.push(h('button', { class: ['set-wall-item', 'set-wall-dyn', on && 'active'], onClick: () => (on ? setSetting('lockWallpaper', null) : setDynamic(true)) },
            W.thumbInto(h('div', { class: 'set-wall-thumb' }, h('span', { class: 'swp-badge', html: icon('wpShuffle', 16) })), wp), h('span', null, t('set.wp.dynamic'))));
        }
        for (const id of ids) {
          const wp = { type: 'photo', id };
          const used = W.usedOn(wp);
          const del = h('button', { class: 'set-wall-del', 'aria-label': t('common.delete'), title: t('common.delete'), html: icon('close', 14), onClick: async (e) => {
            e.stopPropagation();
            if (!(await confirm(t('set.wp.delTitle'), t('set.wp.delMsg'), { okLabel: t('common.delete'), danger: true }))) return;
            await W.removePhoto(id);
          } });
          items.push(h('div', { class: ['set-wall-item', 'set-wall-photo', used && 'active'], role: 'button', tabindex: 0, dataset: { id }, onClick: () => apply(wp), onKeydown: (e) => e.key === 'Enter' && apply(wp) },
            W.thumbInto(h('div', { class: 'set-wall-thumb' }), wp), del, h('span', null, used ? t('set.wp.on.' + used) : ' ')));
        }
        photosBox.replaceChildren(...items);
        photosCard.hidden = !ids.length;
      };
      const addPhotosFlow = async () => {
        const files = await pickFile('image/*', true);
        if (!files?.length) return;
        toast(t('set.wp.adding'));
        const ids = await W.addPhotos(files);
        if (!ids.length) return toast(t('set.wp.addFail'));
        await apply({ type: 'photo', id: ids[ids.length - 1] });
      };
      drawPhotos();

      const recent = h('div', { class: 'set-wall-grid' });
      const recentCard = card(recent);
      const drawRecent = () => {
        const list2 = (store.get('genWalls') || []).slice(0, 8);
        recent.replaceChildren(...list2.map((g) => {
          const wp = { type: 'gen', spec: g.spec, prompt: g.prompt, style: g.style, mood: g.mood };
          return h('button', { class: ['set-wall-item', W.usedOn(wp) && 'active'], title: g.prompt, onClick: () => apply(wp) }, W.thumbInto(h('div', { class: 'set-wall-thumb' }), wp), h('span', null, g.prompt || t('set.wp.creative')));
        }));
        recentCard.hidden = !list2.length;
      };
      drawRecent();

      const grid = h('div', { class: 'set-wall-grid set-presets' });
      const drawGrid = () => {
        grid.replaceChildren(...W.PRESETS.map((p) => {
          const wp = { type: 'preset', id: p.id };
          const used = W.usedOn(wp);
          const th = W.thumbInto(h('div', { class: 'set-wall-thumb' }), wp);
          if (p.dual) th.append(h('span', { class: 'swp-badge dual', title: t('set.wp.dual'), html: icon('wpHalf', 14) }));
          return h('button', { class: ['set-wall-item', used && 'active'], dataset: { id: p.id }, title: t('wall.' + p.id), onClick: () => apply(wp) }, th, h('span', null, t('wall.' + p.id)));
        }));
      };
      drawGrid();

      const solids = h('div', { class: 'ou-swatches set-solids' }, ...W.SOLIDS.map((c) => h('button', {
        class: ['ou-swatch', W.usedOn({ type: 'color', value: c }) && 'active'], style: { background: c }, title: c, 'aria-label': c, onClick: () => apply({ type: 'color', value: c }),
      })));

      body.append(
        subheader(t('set.wp.collection')),
        card(grid),
        subheader(t('set.wp.gallery')),
        photosCard,
        list(row({ icon: 'image', iconBg: '#2aa7d8', title: t('set.fromPhotos'), sub: t('set.fromPhotosSub'), className: 'muted-sub', onClick: addPhotosFlow })),
        subheader(t('set.wp.creative')),
        list(row({ icon: 'wpWand', iconBg: 'linear-gradient(135deg,#7c5cff,#ff6fb1)', title: t('set.wp.creativeMake'), sub: t('set.wp.creativeSub'), chevron: true, className: 'muted-sub set-wp-creative', onClick: () => creativePage(ctx) })),
        recentCard,
        subheader(t('set.colors')),
        card(solids),
        list(row({ icon: 'globe', title: t('set.bing'), sub: t('set.bingSub'), className: 'muted-sub', onClick: async () => {
          toast(t('set.loading'));
          const u = await W.bingUrl();
          if (!u) return toast(t('set.bingFail'));
          await apply({ type: 'bing' });
        } })));
      const redraw = () => {
        drawPhotos();
        drawGrid();
        drawRecent();
        solids.querySelectorAll('.ou-swatch').forEach((b) => b.classList.toggle('active', !!W.usedOn({ type: 'color', value: b.title })));
      };
      const offs = [onSetting('wallpaper', redraw), onSetting('lockWallpaper', redraw), store.on('wallPhotos', redraw), store.on('genWalls', drawRecent)];
      return () => offs.forEach((f) => f());
    },
  });
}

// ——— Creative wallpaper (describe → generate, on this device) ———
function creativePage(ctx) {
  let style = 'waves', mood = 'vivid';
  ctx.push({
    title: t('set.wp.creative'),
    render(body) {
      const input = h('input', { class: 'ou-input set-gen-input', type: 'text', maxlength: 80, placeholder: t('set.wp.describe'), 'aria-label': t('set.wp.describe'), value: store.get('genLast') || '', onKeydown: (e) => e.key === 'Enter' && create() });
      const chips = (items, cur, set, prefix) => {
        const el = h('div', { class: 'ou-chips set-gen-chips' });
        const draw = () => el.replaceChildren(...items.map((x) => h('button', { class: ['ou-chip', x === cur() && 'active'], dataset: { v: x }, onClick: () => { set(x); draw(); } }, t(prefix + x))));
        draw();
        return el;
      };
      const results = h('div', { class: 'set-gen-results' });
      const ideas = h('div', { class: 'ou-chips set-gen-ideas' }, ...Array.from({ length: W.GEN_IDEAS }, (_, i) => h('button', { class: 'ou-chip', onClick: () => { input.value = t('wall.idea.' + i); create(); } }, t('wall.idea.' + i))));
      function create() {
        const prompt = input.value.trim() || t('wall.idea.' + Math.floor(Math.random() * W.GEN_IDEAS));
        input.value = prompt;
        store.set('genLast', prompt);
        const base = Math.floor(Math.random() * 1e4);
        const specs = [0, 1, 2, 3].map((i) => W.generate(prompt, style, mood, base + i));
        results.replaceChildren(...specs.map((spec, i) => {
          const wp = { type: 'gen', spec, prompt, style, mood };
          const th = W.thumbInto(h('div', { class: 'set-wall-thumb' }), wp, 120, 250);
          th.append(h('div', { class: 'swp-lock' }, h('b', null, fmtHM().split(':')[0]), h('b', null, fmtHM().split(':')[1])));
          return h('button', { class: 'set-wall-item set-gen-item', style: { animationDelay: i * 70 + 'ms' }, onClick: () => preview(wp) }, th);
        }));
        results.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      async function preview(wp) {
        const big = W.thumbInto(h('div', { class: 'set-wall-thumb set-gen-big' }), wp, 260, 540);
        big.append(h('div', { class: 'swp-lock' }, h('small', null, fmtDate(new Date(), { weekday: 'short', day: 'numeric', month: 'short' })), h('b', null, fmtHM().split(':')[0]), h('b', null, fmtHM().split(':')[1])));
        const ok = await dialog({ title: wp.prompt, className: 'set-gen-dialog', content: h('div', { class: 'set-gen-prev' }, big), actions: [{ label: t('common.cancel'), value: false }, { label: t('set.wp.setWallpaper'), value: true, primary: true }] });
        if (!ok) return;
        if (!(await apply(wp))) return;
        store.update('genWalls', (l) => [{ prompt: wp.prompt, style: wp.style, mood: wp.mood, spec: wp.spec }, ...(l || []).filter((x) => JSON.stringify(x.spec) !== JSON.stringify(wp.spec))].slice(0, 12));
      }
      body.append(
        card(h('div', { class: 'set-hint' }, t('set.wp.creativeHint')),
          h('div', { class: 'set-gen-row' }, input, btn(t('set.wp.generate'), () => create(), 'primary set-gen-go'))),
        results,
        subheader(t('set.wp.style')),
        card(chips(W.GEN_STYLES, () => style, (v) => (style = v), 'set.wp.st.'), h('div', { class: 'set-gap' }), chips(W.GEN_MOODS, () => mood, (v) => (mood = v), 'set.wp.md.')),
        subheader(t('set.wp.ideas')),
        card(ideas));
    },
  });
}

// ——— Color palette ———
const tones = (c) => {
  const [r, g, b] = hexToRgb(c);
  const [hh, s] = rgbToHsl(r, g, b);
  return [toAccent(c, false), rgbToHex(...hslToRgb(hh, Math.min(0.75, Math.max(0.35, s)), 0.82)), rgbToHex(...hslToRgb(hh, Math.min(0.7, Math.max(0.3, s)), 0.3))];
};
function chip(value, base, onPick) {
  const [a, b, c] = tones(base);
  const cur = setting('accent') || 'auto';
  return h('button', {
    class: ['set-pal', (cur === value || (value === 'wall:0' && cur === 'auto')) && 'active'], dataset: { value: value === 'wall:0' ? 'auto' : value }, title: value === 'wall:0' ? 'auto' : value,
    'aria-label': value.startsWith('wall:') ? t('set.pal.wallN', { n: +value.slice(5) + 1 }) : base,
    style: { background: `conic-gradient(from -90deg, ${a} 0 50%, ${b} 0 75%, ${c} 0)` },
    onClick: () => onPick(value === 'wall:0' ? 'auto' : value),
  });
}

function palettePage(ctx) {
  ctx.push({
    title: t('set.palette'),
    render(body) {
      let tab = String(setting('accent') || 'auto').startsWith('#') ? 'basic' : 'wall';
      const sample = h('div', { class: 'set-pal-sample' },
        h('div', { class: 'set-pal-tiles' }, ...['wifi', 'sound', 'moon', 'flashlight'].map((ic, i) => h('span', { class: ['set-pal-tile', i < 2 && 'on'], html: icon(ic, 20) }))),
        h('div', { class: 'set-pal-bar' }, h('i')),
        h('div', { class: 'set-pal-btns' }, h('span', { class: 'set-pal-btn' }, t('common.ok')), h('span', { class: 'set-pal-sw' }, h('i'))));
      const grid = h('div', { class: 'set-pal-grid' });
      const pick = (v) => {
        setSetting('accent', v);
        draw();
      };
      const draw = () => {
        if (tab === 'wall') {
          const cols = W.wallColors();
          grid.replaceChildren(...cols.map((c, i) => chip('wall:' + i, c, pick)));
        } else grid.replaceChildren(...BASIC.map((c) => chip(c, c, pick)));
      };
      const tabs = seg([{ value: 'wall', label: t('set.pal.wallColors') }, { value: 'basic', label: t('set.pal.basicColors') }], tab, (v) => { tab = v; draw(); });
      tabs.classList.add('set-pal-tabs');
      draw();
      const themed = switchRow({ title: t('set.pal.icons'), sub: t('set.pal.iconsSub'), checked: setting('iconStyle') === 'themed', onChange: (v) => setSetting('iconStyle', v ? 'themed' : 'default') });
      body.append(card(sample), card(tabs, h('div', { class: 'set-gap' }), grid), list(themed));
      const offs = [W.onWallColors(draw), onSetting('accent', draw)];
      return () => offs.forEach((f) => f());
    },
  });
}

addStrings({
  en: {
    'set.wp.change': 'Change wallpapers',
    'set.wp.setOn': 'Set as wallpaper on',
    'set.wp.both': 'Lock and Home screens',
    'set.wp.dynamic': 'Dynamic Lock screen',
    'set.wp.dynamicSub': 'Show a different photo from your gallery each time the Lock screen shows',
    'set.wp.dynamicOn': 'Dynamic Lock screen on',
    'set.wp.needTwo': 'Add at least 2 photos for Dynamic Lock screen',
    'set.wp.darkDim': 'Dim wallpaper when Dark mode is on',
    'set.wp.darkDimSub': 'Makes the wallpaper easier on your eyes at night',
    'set.wp.gallery': 'Gallery',
    'set.wp.add': 'Add',
    'set.wp.adding': 'Adding photos…',
    'set.wp.addFail': 'Couldn’t add that picture',
    'set.wp.delTitle': 'Delete this photo?',
    'set.wp.delMsg': 'It will be removed from your wallpapers on this computer.',
    'set.wp.on.both': 'Lock and Home',
    'set.wp.on.home': 'Home screen',
    'set.wp.on.lock': 'Lock screen',
    'set.wp.creative': 'Creative wallpaper',
    'set.wp.creativeMake': 'Make a wallpaper',
    'set.wp.creativeSub': 'Describe a scene, a mood or colors and get a one-of-a-kind wallpaper',
    'set.wp.creativeHint': 'Made on this computer from your words. Nothing is sent anywhere.',
    'set.wp.describe': 'e.g. “sunset over the ocean”',
    'set.wp.generate': 'Generate',
    'set.wp.style': 'Style',
    'set.wp.ideas': 'Try these',
    'set.wp.setWallpaper': 'Set as wallpaper',
    'set.wp.st.waves': 'Waves',
    'set.wp.st.blobs': 'Blobs',
    'set.wp.st.aurora': 'Aurora',
    'set.wp.st.hills': 'Hills',
    'set.wp.st.glass': 'Glass',
    'set.wp.md.vivid': 'Vivid',
    'set.wp.md.calm': 'Calm',
    'set.wp.md.pastel': 'Pastel',
    'set.wp.md.dark': 'Dark',
    'set.wp.collection': 'Bloom wallpapers',
    'set.wp.dual': 'Changes with Dark mode',
    'set.pal.fromWall': 'Wallpaper colors',
    'set.pal.basic': 'Basic colors',
    'set.pal.wallColors': 'Wallpaper colors',
    'set.pal.basicColors': 'Basic colors',
    'set.pal.wallN': 'Wallpaper color {n}',
    'set.pal.icons': 'Apply palette to app icons',
    'set.pal.iconsSub': 'Themed icons in your palette’s colors',
  },
  ar: {
    'set.wp.change': 'تغيير الخلفيات',
    'set.wp.setOn': 'تعيين كخلفية على',
    'set.wp.both': 'شاشة القفل والشاشة الرئيسية',
    'set.wp.dynamic': 'شاشة القفل الديناميكية',
    'set.wp.dynamicSub': 'عرض صورة مختلفة من معرضك في كل مرة تظهر فيها شاشة القفل',
    'set.wp.dynamicOn': 'تم تشغيل شاشة القفل الديناميكية',
    'set.wp.needTwo': 'أضف صورتين على الأقل لشاشة القفل الديناميكية',
    'set.wp.darkDim': 'تعتيم الخلفية عند تشغيل الوضع الداكن',
    'set.wp.darkDimSub': 'يجعل الخلفية أريح لعينيك ليلًا',
    'set.wp.gallery': 'المعرض',
    'set.wp.add': 'إضافة',
    'set.wp.adding': 'جارٍ إضافة الصور…',
    'set.wp.addFail': 'تعذرت إضافة هذه الصورة',
    'set.wp.delTitle': 'هل تريد حذف هذه الصورة؟',
    'set.wp.delMsg': 'ستُزال من خلفياتك على هذا الكمبيوتر.',
    'set.wp.on.both': 'القفل والرئيسية',
    'set.wp.on.home': 'الشاشة الرئيسية',
    'set.wp.on.lock': 'شاشة القفل',
    'set.wp.creative': 'خلفية إبداعية',
    'set.wp.creativeMake': 'إنشاء خلفية',
    'set.wp.creativeSub': 'صِف مشهدًا أو مزاجًا أو ألوانًا واحصل على خلفية فريدة',
    'set.wp.creativeHint': 'تُصنع على هذا الكمبيوتر من كلماتك. لا يُرسَل أي شيء إلى أي مكان.',
    'set.wp.describe': 'مثل «غروب فوق المحيط»',
    'set.wp.generate': 'إنشاء',
    'set.wp.style': 'النمط',
    'set.wp.ideas': 'جرّب هذه',
    'set.wp.setWallpaper': 'تعيين كخلفية',
    'set.wp.st.waves': 'أمواج',
    'set.wp.st.blobs': 'فقاعات',
    'set.wp.st.aurora': 'شفق',
    'set.wp.st.hills': 'تلال',
    'set.wp.st.glass': 'زجاج',
    'set.wp.md.vivid': 'زاهٍ',
    'set.wp.md.calm': 'هادئ',
    'set.wp.md.pastel': 'باستيل',
    'set.wp.md.dark': 'داكن',
    'set.wp.collection': 'خلفيات Bloom',
    'set.wp.dual': 'تتغير مع الوضع الداكن',
    'set.pal.fromWall': 'ألوان الخلفية',
    'set.pal.basic': 'الألوان الأساسية',
    'set.pal.wallColors': 'ألوان الخلفية',
    'set.pal.basicColors': 'الألوان الأساسية',
    'set.pal.wallN': 'لون الخلفية {n}',
    'set.pal.icons': 'تطبيق اللوحة على أيقونات التطبيقات',
    'set.pal.iconsSub': 'أيقونات بألوان لوحتك',
  },
});
