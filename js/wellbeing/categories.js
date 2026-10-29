// Digital Wellbeing categories (Social, Games, Entertainment…) and a bundled map from popular websites around the world
// to them, ported from Liquid Tab's Screen Time. Nothing is looked up online: a site that isn't here counts as "Other"
// until the person picks a category for it (Digital Wellbeing › the site › Category), kept in `wellbeing.cats`.
// Pure module (no DOM, no storage): the service worker, the app and the blocking page all use it.

/** Twelve categories with a fixed One UI colour and glyph each, so a category looks the same in every chart and widget. */
export const CATS = {
  social: { color: '#3e8bff', icon: 'wbChat' },
  games: { color: '#9b6cf5', icon: 'wbGame' },
  entertainment: { color: '#f2556b', icon: 'wbFilm' },
  creativity: { color: '#ff7ab6', icon: 'wbBrush' },
  productivity: { color: '#ffa53a', icon: 'wbWork' },
  education: { color: '#f2c200', icon: 'wbSchool' },
  reading: { color: '#26b5c9', icon: 'wbBook' },
  health: { color: '#2fbf71', icon: 'wbHeart' },
  utilities: { color: '#6f7f96', icon: 'wbTool' },
  shopping: { color: '#1fae96', icon: 'wbBag' },
  travel: { color: '#5a6cf2', icon: 'airplane' },
  other: { color: '#a3a7b0', icon: 'wbDots' },
};
export const CAT_IDS = Object.keys(CATS);

// Sites people use most in every UI language (Arabic, Indian, Japanese, Korean, Chinese, Russian, Turkish, Indonesian,
// Brazilian and European ones included). A subdomain listed on its own ("mail.google.com") wins over its parent.
const LIST = {
  social: `facebook.com fb.com instagram.com x.com twitter.com tiktok.com snapchat.com linkedin.com pinterest.com reddit.com
    tumblr.com threads.net threads.com bsky.app mastodon.social discord.com discord.gg web.whatsapp.com whatsapp.com messenger.com
    telegram.org web.telegram.org t.me quora.com nextdoor.com meetup.com skype.com viber.com truthsocial.com vk.com ok.ru
    pikabu.ru weibo.com douban.com zhihu.com tieba.baidu.com xiaohongshu.com weixin.qq.com wechat.com line.me kakao.com
    story.kakao.com band.us cafe.naver.com blog.naver.com ameblo.jp mixi.jp 5ch.net 2ch.sc note.com eksisozluk.com
    sharechat.com mojapp.in kaskus.co.id`,
  games: `store.steampowered.com steampowered.com steamcommunity.com epicgames.com roblox.com minecraft.net chess.com lichess.org
    poki.com crazygames.com miniclip.com itch.io ea.com playstation.com xbox.com nintendo.com battle.net blizzard.com
    riotgames.com leagueoflegends.com playvalorant.com fortnite.com ign.com gamespot.com kongregate.com armorgames.com
    coolmathgames.com gog.com humblebundle.com friv.com y8.com slither.io krunker.io agar.io geoguessr.com garena.com
    hoyoverse.com hoyolab.com nexon.com ncsoft.com 4399.com 7k7k.com op.gg curseforge.com nexusmods.com wordle.org
    neal.fun gamer.com.tw 4gamer.net dmm.games`,
  entertainment: `youtube.com youtu.be music.youtube.com netflix.com twitch.tv kick.com disneyplus.com hulu.com primevideo.com
    max.com hbomax.com paramountplus.com peacocktv.com crunchyroll.com spotify.com open.spotify.com soundcloud.com
    music.apple.com tv.apple.com music.amazon.com deezer.com tidal.com pandora.com vimeo.com dailymotion.com imdb.com
    rottentomatoes.com letterboxd.com 9gag.com plex.tv pluto.tv tubi.tv shahid.mbc.net osnplus.com anghami.com tod.tv
    starzplay.com watchit.com bilibili.com iqiyi.com youku.com v.qq.com y.qq.com music.163.com kugou.com mgtv.com
    ixigua.com douyin.com kuaishou.com nicovideo.jp abema.tv tver.jp unext.jp hotstar.com jiocinema.com jiohotstar.com zee5.com
    sonyliv.com gaana.com jiosaavn.com wynk.in mxplayer.in kinopoisk.ru ivi.ru okko.tv rutube.ru music.yandex.ru
    vkvideo.ru puhutv.com blutv.com exxen.com gain.tv tabii.com vidio.com viu.com globoplay.globo.com canalplus.com
    joyn.de ardmediathek.de zdf.de itv.com channel4.com raiplay.it mediasetinfinity.mediaset.it atresplayer.com
    wavve.com tving.com coupangplay.com watcha.com melon.com webtoons.com comic.naver.com webtoon.kakao.com`,
  creativity: `figma.com canva.com adobe.com express.adobe.com behance.net dribbble.com deviantart.com artstation.com pixlr.com
    photopea.com unsplash.com pexels.com flickr.com 500px.com sketchfab.com midjourney.com leonardo.ai runwayml.com
    capcut.com clipchamp.com kapwing.com veed.io splice.com bandlab.com soundtrap.com excalidraw.com framer.com
    webflow.com wix.com squarespace.com coolors.co freepik.com shutterstock.com gettyimages.com remove.bg pixiv.net
    lofter.com tinkercad.com`,
  productivity: `mail.google.com gmail.com docs.google.com drive.google.com sheets.google.com slides.google.com calendar.google.com
    meet.google.com keep.google.com gemini.google.com outlook.live.com outlook.office.com outlook.office365.com outlook.com
    live.com office.com microsoft365.com onedrive.live.com teams.microsoft.com teams.live.com sharepoint.com
    copilot.microsoft.com notion.so notion.site slack.com zoom.us trello.com asana.com monday.com clickup.com
    atlassian.net atlassian.com linear.app basecamp.com smartsheet.com wrike.com airtable.com todoist.com evernote.com
    dropbox.com box.com mail.yahoo.com proton.me icloud.com zoho.com salesforce.com hubspot.com docusign.com calendly.com
    loom.com miro.com chatgpt.com chat.openai.com openai.com claude.ai perplexity.ai grok.com poe.com deepseek.com
    chat.deepseek.com kimi.com doubao.com tongyi.aliyun.com yiyan.baidu.com github.com gitlab.com bitbucket.org
    stackoverflow.com stackexchange.com vercel.com netlify.com aws.amazon.com console.cloud.google.com portal.azure.com
    cloudflare.com digitalocean.com replit.com codesandbox.io stackblitz.com codepen.io paypal.com stripe.com wise.com
    revolut.com chase.com bankofamerica.com wellsfargo.com citi.com capitalone.com americanexpress.com robinhood.com
    coinbase.com binance.com kraken.com tradingview.com finance.yahoo.com investing.com intuit.com xero.com n26.com
    monzo.com nubank.com.br itau.com.br bb.com.br bradesco.com.br mercadopago.com.br paytm.com phonepe.com zerodha.com
    kite.zerodha.com groww.in online.sberbank.ru sberbank.ru tbank.ru tinkoff.ru alipay.com klikbca.com
    alrajhibank.com.sa emiratesnbd.com feishu.cn larksuite.com dingtalk.com wps.com kdocs.cn yuque.com e.mail.ru
    mail.yandex.ru disk.yandex.ru mail.naver.com mail.qq.com mail.163.com grammarly.com`,
  education: `coursera.org edx.org khanacademy.org udemy.com duolingo.com quizlet.com chegg.com brilliant.org codecademy.com
    freecodecamp.org w3schools.com developer.mozilla.org scholar.google.com classroom.google.com instructure.com
    blackboard.com moodle.org byjus.com unacademy.com vedantu.com pw.live nptel.ac.in swayam.gov.in xuetangx.com
    icourse163.org zuoyebang.com stepik.org skyeng.ru uchi.ru ruangguru.com zenius.net brainly.com brainly.co.id
    babbel.com memrise.com busuu.com ted.com ocw.mit.edu academia.edu researchgate.net arxiv.org jstor.org
    sciencedirect.com wolframalpha.com desmos.com geogebra.org overleaf.com mathway.com photomath.com kahoot.com
    kahoot.it quizizz.com studocu.com coursehero.com sparknotes.com edraak.org rwaq.org noon-academy.com
    madrasa.org skillshare.com masterclass.com`,
  reading: `wikipedia.org wikihow.com britannica.com dictionary.com merriam-webster.com dictionary.cambridge.org thesaurus.com
    goodreads.com read.amazon.com audible.com scribd.com wattpad.com feedly.com flipboard.com getpocket.com medium.com
    substack.com news.ycombinator.com news.google.com nytimes.com washingtonpost.com theguardian.com bbc.com bbc.co.uk
    cnn.com foxnews.com nbcnews.com cbsnews.com abcnews.go.com reuters.com apnews.com bloomberg.com wsj.com ft.com
    economist.com forbes.com businessinsider.com cnbc.com npr.org usatoday.com latimes.com politico.com axios.com
    theverge.com techcrunch.com wired.com arstechnica.com engadget.com theatlantic.com newyorker.com time.com espn.com
    bleacherreport.com goal.com weather.com accuweather.com aljazeera.com aljazeera.net alarabiya.net skynewsarabia.com
    youm7.com masrawy.com almasryalyoum.com ahram.org.eg sabq.org okaz.com.sa alkhaleej.ae emaratalyoum.com hespress.com
    elwatannews.com mawdoo3.com kooora.com ndtv.com timesofindia.indiatimes.com indiatimes.com hindustantimes.com
    thehindu.com indianexpress.com news18.com aajtak.in bhaskar.com jagran.com amarujala.com livemint.com
    moneycontrol.com cricbuzz.com yahoo.co.jp news.yahoo.co.jp asahi.com yomiuri.co.jp nikkei.com mainichi.jp
    nhk.or.jp livedoor.com news.naver.com chosun.com joongang.co.kr donga.com hani.co.kr yna.co.kr namu.wiki sina.com.cn
    sohu.com 163.com qq.com thepaper.cn ifeng.com people.com.cn xinhuanet.com chinadaily.com.cn caixin.com toutiao.com
    dzen.ru ria.ru tass.ru rbc.ru lenta.ru kommersant.ru meduza.io habr.com sports.ru hurriyet.com.tr sozcu.com.tr
    milliyet.com.tr sabah.com.tr ntv.com.tr haberturk.com cnnturk.com kompas.com detik.com tribunnews.com liputan6.com
    cnnindonesia.com tempo.co kumparan.com okezone.com globo.com g1.globo.com ge.globo.com uol.com.br folha.uol.com.br
    estadao.com.br terra.com.br r7.com abril.com.br spiegel.de bild.de zeit.de faz.net sueddeutsche.de welt.de
    tagesschau.de n-tv.de t-online.de heise.de kicker.de lemonde.fr lefigaro.fr liberation.fr francetvinfo.fr
    20minutes.fr ouest-france.fr lequipe.fr elpais.com elmundo.es abc.es lavanguardia.com marca.com as.com
    corriere.it repubblica.it ilsole24ore.com ansa.it lastampa.it gazzetta.it dw.com euronews.com france24.com
    archive.org yahoo.com msn.com`,
  health: `myfitnesspal.com strava.com fitbit.com onepeloton.com webmd.com mayoclinic.org healthline.com nhs.uk headspace.com
    calm.com noom.com connect.garmin.com garmin.com whoop.com zocdoc.com practo.com 1mg.com pharmeasy.in flo.health
    sleepfoundation.org cronometer.com verywellhealth.com medlineplus.gov cdc.gov who.int gotokeep.com dxy.cn haodf.com
    medicalnewstoday.com menshealth.com womenshealthmag.com bodybuilding.com alodokter.com halodoc.com
    vezeeta.com altibbi.com`,
  utilities: `google.com bing.com duckduckgo.com baidu.com yandex.ru yandex.com ya.ru naver.com daum.net ecosia.org
    search.brave.com startpage.com qwant.com sogou.com so.com translate.google.com deepl.com papago.naver.com
    fanyi.baidu.com translate.yandex.ru timeanddate.com speedtest.net fast.com 1password.com bitwarden.com lastpass.com
    ilovepdf.com smallpdf.com wetransfer.com convertio.co bit.ly tinyurl.com myaccount.google.com accounts.google.com
    passwords.google.com support.google.com chromewebstore.google.com`,
  shopping: `amazon.com ebay.com etsy.com walmart.com target.com bestbuy.com costco.com homedepot.com ikea.com aliexpress.com
    alibaba.com temu.com shein.com wish.com taobao.com tmall.com jd.com pinduoduo.com rakuten.co.jp mercari.com
    jp.mercari.com zozo.jp coupang.com gmarket.co.kr 11st.co.kr musinsa.com flipkart.com myntra.com meesho.com ajio.com
    nykaa.com swiggy.com zomato.com bigbasket.com blinkit.com noon.com namshi.com talabat.com hungerstation.com
    jahez.net jumia.com.eg ozon.ru wildberries.ru avito.ru market.yandex.ru trendyol.com hepsiburada.com n11.com
    getir.com yemeksepeti.com tokopedia.com shopee.co.id shopee.com lazada.co.id bukalapak.com blibli.com
    mercadolivre.com.br mercadolibre.com americanas.com.br magazineluiza.com.br casasbahia.com.br ifood.com.br zalando.de
    zalando.com otto.de cdiscount.com fnac.com leboncoin.fr vinted.com vinted.fr asos.com hm.com zara.com uniqlo.com
    nike.com adidas.com apple.com store.google.com doordash.com ubereats.com grubhub.com instacart.com deliveroo.co.uk
    just-eat.co.uk lieferando.de glovoapp.com wolt.com foodpanda.com meituan.com ele.me dianping.com allrecipes.com
    foodnetwork.com seriouseats.com cooking.nytimes.com tasty.co cookpad.com kurashiru.com delish.com bonappetit.com
    epicurious.com yelp.com tabelog.com opentable.com craigslist.org offerup.com kijiji.ca olx.com.br olx.in
    olx.co.id dubizzle.com opensooq.com haraj.com.sa gumtree.com sahibinden.com kleinanzeigen.de subito.it wallapop.com
    milanuncios.com`,
  travel: `maps.google.com booking.com airbnb.com expedia.com tripadvisor.com kayak.com skyscanner.net skyscanner.com hotels.com
    agoda.com trip.com ctrip.com uber.com lyft.com careem.com grab.com gojek.com bolt.eu olacabs.com makemytrip.com
    goibibo.com irctc.co.in cleartrip.com redbus.in ixigo.com 12306.cn qunar.com fliggy.com didiglobal.com jalan.net
    travel.rakuten.co.jp navitime.co.jp map.naver.com map.kakao.com yanolja.com tutu.ru rzd.ru aviasales.ru 2gis.ru
    obilet.com enuygun.com traveloka.com tiket.com decolar.com latamairlines.com emirates.com qatarairways.com
    flydubai.com saudia.com almosafer.com wego.com rome2rio.com thetrainline.com bahn.de sncf-connect.com renfe.com
    trenitalia.com ryanair.com easyjet.com lufthansa.com delta.com united.com aa.com southwest.com britishairways.com
    airfrance.com turkishairlines.com flypgs.com waze.com openstreetmap.org citymapper.com maps.apple.com
    flightradar24.com vrbo.com hostelworld.com lonelyplanet.com alltrails.com`,
};

/** host (or parent domain) → category id */
export const DOMAINS = {};
for (const [cat, list] of Object.entries(LIST)) for (const d of list.split(/\s+/)) if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) DOMAINS[d] = cat;

// families of national domains ("google.de", "amazon.co.jp") that all belong to one category
const FAMILY = [[/^google\.(com?\.)?[a-z]{2,3}$/, 'utilities'], [/^(amazon|ebay)\.(com?\.)?[a-z]{2,3}$/, 'shopping'], [/^yahoo\.(com?\.)?[a-z]{2}$/, 'reading'], [/^booking\.[a-z]{2,3}$/, 'travel']];
// shared hosts where every subdomain is somebody else's site ("someone.github.io")
const SHARED = new Set(['github.io', 'blogspot.com', 'vercel.app', 'netlify.app', 'pages.dev', 'web.app', 'firebaseapp.com', 'herokuapp.com', 'wordpress.com', 'tumblr.com', 'gitlab.io', 'neocities.org', 'glitch.me', 'carrd.co']);

/** The site a host belongs to, as Digital Wellbeing lists it: "m.youtube.com" → "youtube.com", "mail.google.com" stays. */
export function siteOf(host) {
  host = String(host || '').toLowerCase().replace(/^www\d?\./, '').replace(/\.$/, '');
  if (!host || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return host;
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) { const d = parts.slice(i).join('.'); if (DOMAINS[d]) return d; }
  const n = parts.length;
  // "bbc.co.uk", "uol.com.br", "nhk.or.jp": the registrable part has three labels
  const keep = n > 2 && (/^(co|com|net|org|gov|edu|ac|or|ne|go|gob|mil|nic|sch|ltd|plc|gen|biz|web)$/.test(parts[n - 2]) && parts[n - 1].length === 2 || SHARED.has(parts.slice(-2).join('.'))) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** The category of a site: the person's own choice first, then the bundled map, else "other". */
export function categoryOf(site, overrides) {
  if (overrides?.[site] && CATS[overrides[site]]) return overrides[site];
  if (DOMAINS[site]) return DOMAINS[site];
  for (const [re, c] of FAMILY) if (re.test(site)) return c;
  return 'other';
}
/** The bundled category (what "Reset" goes back to). */
export const defaultCategoryOf = site => categoryOf(site, null);

/** Whether `host` is the site `site` or one of its subdomains. */
export const hostIn = (host, site) => !!site && (host === site || String(host).endsWith('.' + site));
