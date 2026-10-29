// Galaxy Store model (js/store/model.js), plain node: the catalog, charts, the daily rotation and search.
// usage: node .dev/store-model.mjs   (exit 1 on failure)
import * as M from '../js/store/model.js';

let failed = 0, passed = 0;
const ok = (cond, msg) => {
  if (cond) passed++;
  else failed++;
  console.log((cond ? '  ok ' : 'FAIL ') + msg);
};

// catalog
ok(M.APPS.length > 500, `catalog has ${M.APPS.length} websites`);
ok(new Set(M.APPS.map((a) => a.site)).size === M.APPS.length, 'every site is listed once');
ok(M.APPS.every((a) => M.CATS[a.cat] && a.name && a.label && /^https:\/\/[a-z0-9.-]+\/$/.test(a.url) && a.host === a.site), 'every site has a known category, a name, a label and an https URL');
ok(M.CAT_ORDER.length === 11 && M.CAT_ORDER.every((id) => M.inCat(id).length >= 12), '11 categories, each with at least 12 sites');
const wa = M.BY_SITE.get('web.whatsapp.com');
ok(wa.name === 'WhatsApp Messenger' && wa.label === 'WhatsApp' && wa.cat === 'social', 'WhatsApp Messenger gets the short Home screen name “WhatsApp”');
ok(M.catRank(M.BY_SITE.get('youtube.com')) === 1 && M.catRank(M.BY_SITE.get('netflix.com')) > 1, 'YouTube is #1 in Entertainment, Netflix after it');

// charts
const top = M.topChart(22);
ok(top.length === 22 && new Set(top.slice(0, 11).map((a) => a.cat)).size === 11, 'the overall chart takes one site from every category in turn');
ok(top[0] === M.inCat('social')[0] && top[11] === M.inCat('social')[1], 'round robin: #1 and #12 are Social’s first two');
ok(M.topChart(500).length === 500 && new Set(M.topChart(1000).map((a) => a.site)).size === M.APPS.length, 'the chart can list every site once');
ok(M.topChart(5, 'games').every((a, i) => a === M.inCat('games')[i]), 'a category chart is the category in order');
const az = M.alphabetical('travel');
ok(az.every((a, i) => !i || az[i - 1].name.localeCompare(a.name) <= 0) && az.length === M.inCat('travel').length, 'A–Z sorts a category by name');

// daily rotation
const day = M.dayNumber(new Date(2026, 9, 26, 12));
ok(M.dayNumber(new Date(2026, 9, 26, 0, 1)) === day && M.dayNumber(new Date(2026, 9, 26, 23, 59)) === day && M.dayNumber(new Date(2026, 9, 27, 0, 1)) === day + 1, 'the day changes at local midnight');
const d1 = M.discover(day), d1b = M.discover(day), d2 = M.discover(day + 1);
ok(JSON.stringify(d1) === JSON.stringify(d1b), 'Discover is the same all day');
ok(d1.banners.length === 3 && new Set(d1.banners.map((b) => b.cat)).size === 3 && d1.banners.every((b) => b.apps.length === 3 && b.apps.every((a) => a.cat === b.cat)), 'three banners, three distinct categories, three of their sites each');
ok(d1.mustHave.length === 12 && new Set(d1.mustHave).size === 12, 'Must-have lists twelve different sites');
ok(d1.popular.length === 3 && d1.popular.every((p) => p.apps.length === 12 && p.apps.every((a, i) => a.cat === p.cat && (!i || p.apps[i - 1].rank < a.rank))), 'three Popular in … rows of twelve, in chart order');
ok(!d1.popular.some((p) => d1.banners.some((b) => b.cat === p.cat)), 'Popular rows show other categories than the banners');
const sig = (d) => JSON.stringify([d.banners.map((b) => b.cat), d.mustHave.map((a) => a.site), d.popular.map((p) => p.cat), d.pick.site]);
ok(sig(d1) !== sig(d2), 'the next day Discover changes');
const picks = Array.from({ length: 30 }, (_, i) => M.pickOfDay(day + i).site);
ok(new Set(picks).size === 30, 'Today’s pick doesn’t repeat for a month');
ok(M.popularSearches(day).length === 10 && new Set(M.popularSearches(day)).size === 10, 'ten popular searches');
const sim = M.similar(M.BY_SITE.get('twitch.tv'));
ok(sim.length === 9 && sim.every((a) => a.cat === 'entertainment' && a.site !== 'twitch.tv'), 'You might also like: nine other Entertainment sites');

// search
const first = (q) => M.searchApps(q)[0]?.site;
ok(first('netflix') === 'netflix.com', 'netflix → Netflix');
ok(first('duol') === 'duolingo.com', 'duol → Duolingo');
ok(first('whatsapp') === 'web.whatsapp.com', 'whatsapp → WhatsApp');
ok(first('netflix.com') === 'netflix.com', 'an address finds its site');
ok(first('YOUTUBE') === 'youtube.com', 'case does not matter');
ok(M.searchApps('youtube').length >= 3 && M.searchApps('youtube').slice(0, 4).every((a) => /youtube/i.test(a.name)), 'youtube lists the YouTube family');
ok(M.searchApps('zzqqxx').length === 0 && M.searchApps('').length === 0, 'nonsense and empty queries find nothing');
ok(first('ytmusic') === 'music.youtube.com' && M.searchApps('ytmusic', { min: 400 }).length === 0, 'letters in order find YouTube Music, a weak hit that can be left out');
ok(M.appForHost('www.netflix.com')?.site === 'netflix.com' && M.appForHost('example.org') === null, 'appForHost');

console.log(`---- ${passed} passed, ${failed} failed ----`);
process.exit(failed ? 1 : 0);
