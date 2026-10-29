// Weather › ⋮ › Settings (One UI): units (temperature, wind speed, pressure, precipitation, visibility), "Use current
// location" and rain alerts (the service worker checks the main location every 30 minutes, js/bg/weather.js).
// Temperature is the shared setting `tempUnit` (Settings › Weather uses it too); the rest live in `weatherPrefs`.
import { h } from '../core/util.js';
import { t } from '../core/i18n.js';
import { setting, setSetting, store } from '../core/store.js';
import { list, row, switchRow, subheader, seg, choose, card, toast } from '../core/ui.js';
import { HERE, prefs, setPref, places, setUseCurrent, placeName, peekPlace, unitLabel, UNIT_CHOICES, autoUnit } from '../services/weather.js';

const ROWS = [['wind', 'wx.windUnit'], ['pressure', 'wx.pressureUnit'], ['precip', 'wx.precipUnit'], ['dist', 'wx.distUnit']];

export function openSettings(ctx) {
  const pg = ctx.push({
    title: t('common.settings'),
    hero: true,
    className: 'wx-setpage',
    render(body) {
      ctx.win.style.background = '';
      const draw = () => {
        const p = prefs(), list0 = places(), main = list0[0];
        const unitRow = ([key, title]) => {
          const v = p[key], auto = !UNIT_CHOICES[key].includes(v);
          return row({
            title: t(title),
            sub: auto ? t('wx.auto', { u: unitLabel(autoUnit(key)) }) : `${t('wx.un.' + v)} (${unitLabel(v)})`,
            className: 'wx-unit-row',
            onClick: async () => {
              // "Auto" says what it picks right now: Fahrenheit people get mph, inches and miles
              const next = await choose(t(title), [{ value: 'auto', label: t('wx.auto', { u: unitLabel(autoUnit(key)) }) }, ...UNIT_CHOICES[key].map((u) => ({ value: u, label: t('wx.un.' + u), sub: unitLabel(u) }))], auto ? 'auto' : v);
              if (next != null) setPref(key, next);
              draw();
            },
          });
        };
        body.replaceChildren(
          subheader(t('wx.units')),
          list(
            h('div', { class: 'ou-row wx-temp-row' }, h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('wx.tempUnit'))),
              seg([{ value: 'c', label: '°C' }, { value: 'f', label: '°F' }], setting('tempUnit') === 'f' ? 'f' : 'c', (u) => {
                setSetting('tempUnit', u);
                draw();
              })),
            ...ROWS.map(unitRow)),
          subheader(t('wx.location')),
          list(switchRow({
            icon: 'navigation', title: t('wx.useCurrent'), sub: t('wx.useCurrentSub'), checked: list0.some((x) => x.id === HERE),
            onChange: (on) => {
              if (!on && list0.length < 2) {
                toast(t('wx.keepOne'));
                return draw();
              }
              setUseCurrent(on);
              draw();
            },
          })),
          subheader(t('wx.notifs')),
          list(switchRow({
            icon: 'umbrella', title: t('wx.rainAlert'), sub: t('wx.rainAlertSub', { place: placeName(main, peekPlace(main, list0)) }), checked: !!p.rainAlert,
            onChange: (on) => {
              setPref('rainAlert', on);
              if (on) toast(t('wx.rainAlertOn'));
            },
          })),
          card(h('p', { class: 'wx-about' }, t('wx.aboutData'))));
      };
      draw();
      return store.on('weatherPlaces', draw);
    },
  });
  pg.onReturn = () => (ctx.win.style.background = '');
}
