// Samsung Wallet's window (loaded when the app opens): Home with the Quick access card stack, what's coming up and a
// row per category; Menu with Samsung's categories (Boarding passes, Tickets, Membership cards, Coupons, Gift cards,
// Digital keys, IDs, Other passes); the pass detail page with its big barcode (full screen at full brightness on a
// tap); Add to Wallet; Wallet settings. Subscriptions and bills live in bills.js, Spending in spend.js, the pass
// editor in edit.js. Four floating One UI tabs switch between Home, Bills, Spending and Menu.
import { h, escapeHtml as esc, frag } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast, menu, confirm, choose, row, switchRow, list, subheader, iconBtn } from '../core/ui.js';
import { delBlob } from '../core/blobs.js';
import * as M from './model.js';
import { data, mutate, currency, nextBills, monthTotal, onWallet } from './data.js';
import { money, moneyLines, currencyList, currencyName } from './money.js';
import { cardHTML, hydrate, detailFields, TRANSIT_ICON } from './card.js';
import { codePanelHTML, brightness } from './bright.js';
import { kindInfo, kindName, kindOne, kindOneIn, kindNameIn, passName, passDateText, passTimeText, passWhen, longDate, whenText, subIconHTML, hydrateSubIcons, cnt, subCatName } from './format.js';
import { openEditor, scanAvailable, scanPhoto } from './edit.js';
import { billsView, openSub } from './bills.js';
import { spendView } from './spend.js';
import './strings.js';

const TABS = [['home', 'wl-wallet', 'wallet.tab.home'], ['bills', 'wl-receipt', 'wallet.tab.bills'], ['spend', 'wl-chart', 'wallet.tab.spend'], ['menu', 'list', 'wallet.tab.menu']];
let lastTab = 'home';

export function render(ctx) {
  const env = { ctx, show, openPass: (id) => openPass(env, id), openKind: (k) => openKind(env, k), openAdd: (k) => openAdd(env, k), openSettings: () => openSettings(env), openExpired: () => openExpired(env) };
  const VIEWS = { home: homeView, bills: billsView, spend: spendView, menu: menuView };
  function tabsBar(active) {
    return h('nav', { class: 'ou-tabs wl-tabs', role: 'tablist' }, TABS.map(([id, ic, label]) =>
      h('button', { class: ['ou-tab', id === active && 'active'], role: 'tab', 'aria-selected': String(id === active), dataset: { tab: id }, onClick: () => id !== active && show(id) },
        h('span', { html: icon(ic, 20) }), h('span', null, t(label)))));
  }
  function show(tab, opts = {}) {
    lastTab = VIEWS[tab] ? tab : 'home';
    VIEWS[lastTab](env, tabsBar(lastTab), opts);
  }
  // params: { section: 'home' | 'menu' | 'bills[:<sub id>]' | 'spend' | 'pass:<id>' | '<kind>' | '<sub id>:<date>:<days>' (a bill
  // notification) }, { pass: id }, { add: true | kind }, { expense: true }
  function route(p = {}) {
    const [a, b] = String(p.section || '').split(':');
    const sub = !M.KINDS[a] && !['home', 'menu', 'bills', 'subs', 'spend', 'pass'].includes(a) && data().subs.find((s) => s.id === a);
    if (p.pass || a === 'pass') { show('home'); openPass(env, p.pass || b); }
    else if (p.add) { show('home'); openAdd(env, M.KINDS[p.add] ? p.add : null); }
    else if (a === 'bills' || a === 'subs' || sub) show('bills', { open: sub ? sub.id : b });
    else if (a === 'spend' || p.expense) show('spend', { expense: !!p.expense });
    else if (M.KINDS[a]) { show('menu'); openKind(env, a); }
    else show(a === 'menu' || a === 'home' ? a : lastTab);
  }
  ctx.setParams = (p) => route(p || {});
  route(ctx.params || {});
}

/** Row icon options for a pass (its kind's glyph on its kind's colour) and for a subscription (its site or category). */
const passIco = (p) => ({ icon: kindInfo(p.kind).icon, iconBg: kindInfo(p.kind).color });
const subIco = (s) => ({ icon: subIconHTML(s), iconBg: 'transparent' });

// ———————————————————————————————————————————————————————————— Home
function homeView(env, tabs) {
  const { ctx } = env;
  let query = null, body = null;
  const searchBtn = iconBtn('search', () => { query = query == null ? '' : null; draw(); }, t('common.search'));
  ctx.page({
    title: t('wallet.title'), hero: false, className: 'wl-page wl-home',
    actions: [searchBtn, iconBtn('plus', () => env.openAdd(), t('wallet.add')), iconBtn('more', (e) => menu(e.currentTarget, [
      { label: t('wallet.add'), icon: 'plus', onClick: () => env.openAdd() },
      { label: t('wallet.expired'), icon: 'history', onClick: env.openExpired },
      '-',
      { label: t('wallet.settings'), icon: 'settings', onClick: env.openSettings },
    ], { align: 'end' }), t('common.more'))],
    render(b, page) {
      body = b;
      page.el.appendChild(tabs);
      body.classList.add('wl-body');
      draw();
      return onWallet(() => { if (query == null) draw(); });
    },
  });
  function draw() {
    if (!body) return;
    const d = data(), today = M.keyOf(), live = d.passes.filter((p) => !M.isExpired(p, today));
    const parts = [];
    if (query != null) {
      const box = h('label', { class: 'ou-searchbox wl-search' }, h('span', { html: icon('search', 20) }),
        h('input', { type: 'search', value: query, placeholder: t('wallet.searchPh'), 'aria-label': t('common.search'), onInput: (e) => { query = e.target.value; drawResults(); } }));
      const results = h('div', { class: 'wl-results' });
      const drawResults = () => {
        const q = query.trim();
        if (!q) { results.replaceChildren(); return; }
        const passes = M.searchPasses(d.passes, q), subs = d.subs.filter((s) => s.name.toLocaleLowerCase().includes(q.toLocaleLowerCase()));
        if (!passes.length && !subs.length) { results.replaceChildren(h('div', { class: 'ou-empty' }, h('span', { html: icon('search', 56) }), t('wallet.noResults'))); return; }
        results.replaceChildren(
          passes.length ? list(...passes.map((p) => row({ ...passIco(p), title: passName(p), sub: [kindOne(p.kind), M.passTitle(p)].filter(Boolean).join(' · '), onClick: () => env.openPass(p.id), className: 'muted-sub' }))) : '',
          subs.length ? list(...subs.map((s) => row({ ...subIco(s), title: s.name, sub: money(s.amount, s.cur), onClick: () => openSub(env, s.id), className: 'muted-sub' }))) : '');
        hydrateSubIcons(results);
      };
      drawResults();
      body.replaceChildren(box, results);
      setTimeout(() => box.querySelector('input')?.focus(), 30);
      searchBtn.classList.add('active');
      return;
    }
    searchBtn.classList.remove('active');
    if (!d.passes.length && !d.subs.length && !d.spend.length) {
      body.replaceChildren(frag(`<div class="wl-welcome"><div class="wl-welcome-art">${['#1f4fd1', '#ff7a2f', '#7a3ff2'].map((c, i) => `<i style="--c:${c};--i:${i}"></i>`).join('')}</div>
        <h2>${esc(t('wallet.welcome'))}</h2><p>${esc(t('wallet.welcomeSub'))}</p></div>`), h('button', { class: 'ou-btn primary wl-cta', onClick: () => env.openAdd() }, t('wallet.add')));
      return;
    }
    // Quick access: the cards stacked like in a wallet, each showing its top edge
    const quick = live.filter((p) => p.quick);
    if (quick.length) {
      parts.push(h('div', { class: 'wl-sec-head' }, h('span', null, t('wallet.quick'))));
      const stack = frag(`<div class="wl-stack" style="--n:${quick.length}">${quick.slice(0, 6).map((p) => cardHTML(p, { tag: 'button', attrs: `data-id="${esc(p.id)}" aria-label="${esc(passName(p))}"` })).join('')}</div>`);
      stack.addEventListener('click', (e) => { const c = e.target.closest('[data-id]'); if (c) env.openPass(c.dataset.id); });
      parts.push(stack);
    }
    // Coming up: trips and events this week, and the bills due
    const soon = M.upcomingPasses(live, 7).slice(0, 3), bills = nextBills(7).slice(0, 3);
    if (soon.length || bills.length) {
      parts.push(h('div', { class: 'wl-sec-head' }, h('span', null, t('wallet.comingUp'))));
      parts.push(list(
        ...soon.map((p) => row({ ...passIco(p), title: M.passTitle(p) || passName(p), sub: `${passName(p)} · ${passWhen(p)}${passTimeText(p) ? ' · ' + passTimeText(p) : ''}`, onClick: () => env.openPass(p.id), className: 'muted-sub' })),
        ...bills.map((b) => row({ ...subIco(d.subs.find((s) => s.id === b.id) || b), title: b.name, sub: `${b.trial ? t('wallet.trialEnds') : b.bill ? t('wallet.due') : t('wallet.renews')} · ${whenText(b.date)}`, right: h('span', { class: 'wl-amt' }, money(b.amount, b.currency)), onClick: () => openSub(env, b.id), className: 'muted-sub' }))));
    }
    // a row of cards per category, in Samsung's order
    for (const k of M.KIND_IDS) {
      const ps = live.filter((p) => p.kind === k);
      if (!ps.length) continue;
      parts.push(h('div', { class: 'wl-sec-head' }, h('span', null, kindName(k)), h('b', null, String(ps.length)),
        h('button', { class: 'wl-viewall', onClick: () => env.openKind(k) }, t('wallet.viewAll'), h('span', { html: icon('forward', 16) }))));
      const strip = frag(`<div class="wl-hscroll">${ps.map((p) => cardHTML(p, { cls: 'mini', tag: 'button', attrs: `data-id="${esc(p.id)}" aria-label="${esc(passName(p))}"` })).join('')}</div>`);
      strip.addEventListener('click', (e) => { const c = e.target.closest('[data-id]'); if (c) env.openPass(c.dataset.id); });
      parts.push(strip);
    }
    if (!live.length) parts.push(h('div', { class: 'ou-card wl-nopass' }, h('span', { html: icon('wl-pass', 28) }), h('span', null, t('wallet.noPasses')), h('button', { class: 'ou-btn', onClick: () => env.openAdd() }, t('wallet.add'))));
    // money at a glance
    const tot = M.totals(d.subs).month, cur = currency(), next = nextBills(45)[0], spent = monthTotal();
    parts.push(h('div', { class: 'wl-sec-head' }, h('span', null, t('wallet.money'))));
    parts.push(h('div', { class: 'wl-tiles' },
      h('button', { class: 'wl-tile', onClick: () => env.show('bills') },
        h('span', { class: 'wl-tile-l' }, h('i', { style: { '--c': '#f2556b' }, html: icon('wl-receipt', 16) }), t('wallet.billsTitle')),
        h('b', { class: 'wl-tile-v' }, moneyLines(tot, cur)[0] || money(0, cur)), h('small', null, next ? `${next.name} · ${whenText(next.date)}` : t('wallet.perMonth'))),
      h('button', { class: 'wl-tile', onClick: () => env.show('spend') },
        h('span', { class: 'wl-tile-l' }, h('i', { style: { '--c': '#ff8a3d' }, html: icon('wl-chart', 16) }), t('wallet.tab.spend')),
        h('b', { class: 'wl-tile-v' }, spent.text.split(' · ')[0]), h('small', null, t('wallet.thisMonth')))));
    body.replaceChildren(...parts);
    hydrate(body);
    hydrateSubIcons(body);
  }
}

// ———————————————————————————————————————————————————————————— Menu
function menuView(env, tabs) {
  const { ctx } = env;
  ctx.page({
    title: t('wallet.title'), className: 'wl-page wl-menu',
    actions: [iconBtn('plus', () => env.openAdd(), t('wallet.add'))],
    render(body, page) {
      page.el.appendChild(tabs);
      body.classList.add('wl-body');
      const draw = () => {
        const d = data(), today = M.keyOf(), live = d.passes.filter((p) => !M.isExpired(p, today)), expired = d.passes.length - live.length;
        page.setSubtitle(live.length ? cnt('wallet.nPasses', live.length) : '');
        body.replaceChildren(
          list(...M.KIND_IDS.map((k) => row({ icon: kindInfo(k).icon, iconBg: kindInfo(k).color, title: kindName(k), right: h('span', { class: 'wl-count' }, String(live.filter((p) => p.kind === k).length)), chevron: true, onClick: () => env.openKind(k) }))),
          list(
            row({ icon: 'wl-receipt', iconBg: '#f2556b', title: t('wallet.billsTitle'), right: h('span', { class: 'wl-count' }, String(d.subs.filter((s) => s.state === 'active').length)), chevron: true, onClick: () => env.show('bills') }),
            row({ icon: 'wl-chart', iconBg: '#ff8a3d', title: t('wallet.tab.spend'), chevron: true, onClick: () => env.show('spend') })),
          list(
            row({ icon: 'history', iconBg: '#8a8d96', title: t('wallet.expired'), right: h('span', { class: 'wl-count' }, String(expired)), chevron: true, onClick: env.openExpired }),
            row({ icon: 'settings', iconBg: '#5b6472', title: t('wallet.settings'), chevron: true, onClick: env.openSettings })));
      };
      draw();
      return onWallet(draw);
    },
  });
}

// ———————————————————————————————————————————————————————————— a category, Expired passes
function gridOf(env, passes, cls = '') {
  const g = frag(`<div class="wl-grid ${cls}">${passes.map((p) => cardHTML(p, { cls: 'mini', tag: 'button', attrs: `data-id="${esc(p.id)}" aria-label="${esc(passName(p))}"` })).join('')}</div>`);
  g.addEventListener('click', (e) => { const c = e.target.closest('[data-id]'); if (c) env.openPass(c.dataset.id); });
  return g;
}
function openKind(env, kind) {
  const { ctx } = env;
  ctx.push({
    title: kindName(kind), className: 'wl-page wl-kind', actions: [iconBtn('plus', () => openEditor(env, { kind, after: (p) => env.openPass(p.id) }), t('wallet.addKind', { kind: kindOneIn(kind) }))],
    render(body, page) {
      body.classList.add('wl-body');
      const draw = () => {
        const d = data(), today = M.keyOf(), all = d.passes.filter((p) => p.kind === kind);
        const live = all.filter((p) => !M.isExpired(p, today)), old = all.filter((p) => M.isExpired(p, today));
        page.setSubtitle(live.length ? cnt('wallet.nPasses', live.length) : '');
        const parts = [];
        if (!live.length) parts.push(h('div', { class: 'ou-empty' }, h('span', { html: icon(kindInfo(kind).icon, 56) }), t('wallet.noneOfKind', { kind: kindNameIn(kind) }),
          h('button', { class: 'ou-btn primary', onClick: () => openEditor(env, { kind, after: (p) => env.openPass(p.id) }) }, t('wallet.addKind', { kind: kindOneIn(kind) }))));
        else parts.push(gridOf(env, live));
        if (old.length) parts.push(subheader(t('wallet.expiredSec')), gridOf(env, old, 'dim'));
        body.replaceChildren(...parts);
        hydrate(body);
      };
      draw();
      return onWallet(draw);
    },
  });
}
function openExpired(env) {
  env.ctx.push({
    title: t('wallet.expired'), className: 'wl-page wl-kind',
    render(body) {
      body.classList.add('wl-body');
      const draw = () => {
        const old = data().passes.filter((p) => M.isExpired(p));
        body.replaceChildren(h('p', { class: 'wl-note' }, t('wallet.expiredNote')), old.length ? gridOf(env, old, 'dim') : h('div', { class: 'ou-empty' }, h('span', { html: icon('history', 56) }), t('wallet.noExpired')));
        hydrate(body);
      };
      draw();
      return onWallet(draw);
    },
  });
}

// ———————————————————————————————————————————————————————————— pass details
/** Removes the pictures of a deleted pass that no other pass (a duplicate) still shows. */
export function gcImages(p) {
  const used = new Set(data().passes.flatMap((x) => [x.logo, x.art, x.photo]).filter(Boolean));
  for (const id of [p.logo, p.art, p.photo]) if (id && !used.has(id)) delBlob(id).catch(() => {});
}
export function openPass(env, id) {
  const { ctx } = env;
  const cur = () => data().passes.find((p) => p.id === id);
  if (!cur()) { toast(t('wallet.notFound')); return; }
  const edit = () => { const p = cur(); if (p) openEditor(env, { pass: p }); };
  const more = (e) => {
    const p = cur(), d = data();
    if (!p) return;
    const expired = M.isExpired(p);
    menu(e.currentTarget, [
      { label: t('common.edit'), icon: 'edit', onClick: edit },
      { label: p.quick ? t('wallet.quickOff') : t('wallet.quickOn'), icon: 'wl-quick', onClick: () => mutate((x) => { const q = x.passes.find((y) => y.id === id); if (q) q.quick = !q.quick || undefined; }) },
      { label: t('wallet.showWidget'), icon: 'widgets', checked: d.prefs.widgetPass === id, onClick: () => { mutate((x) => { x.prefs.widgetPass = x.prefs.widgetPass === id ? undefined : id; }); } },
      { label: t('wallet.duplicate'), icon: 'copy', onClick: () => duplicate(p) },
      expired ? { label: t('wallet.restore'), icon: 'refresh', onClick: () => mutate((x) => { const q = x.passes.find((y) => y.id === id); if (q) q.keep = true; }) } : null,
      '-',
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => remove(p) },
    ], { align: 'end' });
  };
  const duplicate = (p) => {
    const copy = M.normPass({ ...structuredClone(p), id: 'p' + Date.now().toString(36), at: Date.now(), keep: undefined });
    mutate((d) => { const i = d.passes.findIndex((x) => x.id === p.id); d.passes.splice(i + 1, 0, copy); });
    toast(t('wallet.duplicated'));
  };
  const remove = async (p) => {
    if (!(await confirm(t('wallet.deleteQ'), t('wallet.deleteMsg', { name: passName(p) }), { okLabel: t('common.delete'), danger: true }))) return;
    ctx.pop();
    mutate((d) => { d.passes = d.passes.filter((x) => x.id !== p.id); d.subs.forEach((s) => { if (s.pass === p.id) delete s.pass; }); if (d.prefs.widgetPass === p.id) delete d.prefs.widgetPass; });
    gcImages(p);
    toast(t('wallet.deleted'));
  };
  let close = null;
  ctx.push({
    title: passName(cur()), hero: false, className: 'wl-page wl-detail',
    actions: [iconBtn('edit', edit, t('common.edit')), iconBtn('more', more, t('common.more'))],
    render(body, page) {
      body.classList.add('wl-body');
      body.addEventListener('click', (e) => {
        const a = e.target.closest('[data-act]');
        const p = cur();
        if (!a || !p) return;
        if (a.dataset.act === 'bright') close = brightness(p);
        else if (a.dataset.act === 'restore') mutate((x) => { const q = x.passes.find((y) => y.id === id); if (q) q.keep = true; });
        else if (a.dataset.act === 'sub') openSub(env, a.dataset.id);
      });
      const draw = () => {
        const p = cur();
        if (!p) return;
        page.setTitle(passName(p));
        const expired = M.isExpired(p);
        const parts = [];
        parts.push(frag(`<div class="wl-hero-card">${cardHTML(p)}</div>`));
        if (expired) parts.push(frag(`<div class="wl-expbar">${icon('history', 18)}<span>${esc(t('wallet.isExpired'))}</span><button class="ou-btn" data-act="restore">${esc(t('wallet.restore'))}</button></div>`));
        const code = codePanelHTML(p);
        if (code) parts.push(frag(code));
        // the trip: both ends, the departure and the means of transport
        if (p.kind === 'boarding') {
          const [a, b] = p.primary;
          parts.push(frag(`<div class="ou-card wl-trip"><div class="wl-trip-end"><b>${esc(a.v) || '—'}</b><span>${esc(a.l)}</span></div>
            <div class="wl-trip-mid">${icon(TRANSIT_ICON[p.transit] || 'airplane', 22)}<small>${esc(passDateText(p, false))}</small></div>
            <div class="wl-trip-end end"><b>${esc(b.v) || '—'}</b><span>${esc(b.l)}</span></div>
            ${passTimeText(p) ? `<div class="wl-trip-dep">${esc(t('wallet.f.departs'))} <b>${esc(passTimeText(p))}</b> · ${esc(passWhen(p))}</div>` : ''}</div>`));
        }
        const fields = detailFields(p);
        const dated = p.date && p.kind !== 'boarding' ? [{ l: p.kind === 'key' ? t('wallet.f.validFrom') : t('wallet.f.dateTime'), v: passDateText(p) }] : [];
        const exp = p.expires ? [{ l: p.kind === 'coupon' || p.kind === 'key' ? t('wallet.f.validUntil') : t('wallet.f.expires'), v: longDate(p.expires) }] : [];
        const grid = [...fields, ...dated, ...exp];
        if (grid.length) parts.push(frag(`<div class="ou-card wl-fields">${grid.map((f) => `<div class="wl-fi"><small>${esc(f.l)}</small><b>${esc(f.v)}</b></div>`).join('')}</div>`));
        const back = p.back.filter((f) => f.v);
        if (back.length || p.notes) {
          parts.push(subheader(t('wallet.moreInfo')));
          parts.push(frag(`<div class="ou-card wl-back">${back.map((f) => `<div class="wl-bf"><small>${esc(f.l)}</small><span>${esc(f.v)}</span></div>`).join('')}${p.notes ? `<div class="wl-bf"><small>${esc(t('wallet.notes'))}</small><span class="notes">${esc(p.notes)}</span></div>` : ''}</div>`));
        }
        // subscriptions paid with this card
        const subs = data().subs.filter((s) => s.pass === p.id);
        if (subs.length) {
          parts.push(subheader(t('wallet.paysFor')));
          parts.push(frag(`<div class="ou-card ou-list">${subs.map((s) => `<button class="ou-row clickable muted-sub" data-act="sub" data-id="${esc(s.id)}">${subIconHTML(s)}<span class="ou-row-text"><span class="ou-row-title">${esc(s.name)}</span><span class="ou-row-sub">${esc(subCatName(s.cat))}</span></span><span class="wl-amt">${esc(money(s.amount, s.cur))}</span></button>`).join('')}</div>`));
        }
        parts.push(list(
          switchRow({ icon: 'wl-quick', title: t('wallet.inQuick'), sub: t('wallet.inQuickSub'), checked: !!p.quick, onChange: (v) => mutate((x) => { const q = x.passes.find((y) => y.id === id); if (q) q.quick = v || undefined; }) })));
        body.replaceChildren(...parts);
        hydrate(body);
        hydrateSubIcons(body);
      };
      draw();
      const off = onWallet(draw);
      return () => { off(); close?.(); };
    },
  });
}

// ———————————————————————————————————————————————————————————— Add to Wallet
function openAdd(env, kind) {
  const { ctx } = env;
  if (kind) { openEditor(env, { kind, after: (p) => { env.openPass(p.id); toast(t('wallet.added')); } }); return; }
  const done = (p) => { ctx.pop(); env.openPass(p.id); toast(t('wallet.added')); };
  ctx.push({
    title: t('wallet.add'), subtitle: t('wallet.addChoose'), className: 'wl-page wl-addlist',
    render(body) {
      body.classList.add('wl-body');
      const scanRow = row({ icon: 'wl-scan', iconBg: '#5b6472', title: t('wallet.scan'), sub: t('wallet.scanSub'), className: 'muted-sub', onClick: async () => {
        const found = await scanPhoto();
        if (found) openEditor(env, { kind: found.type === 'pdf417' ? 'boarding' : found.type === 'qr' ? 'other' : 'member', code: found, after: done });
      } });
      const scanList = list(scanRow);
      scanList.hidden = true;
      scanAvailable().then((ok) => { scanList.hidden = !ok; });
      body.append(
        list(...M.KIND_IDS.map((k) => row({ icon: kindInfo(k).icon, iconBg: kindInfo(k).color, title: kindOne(k), sub: t('wallet.kd.' + k), className: 'muted-sub', chevron: true, onClick: () => openEditor(env, { kind: k, after: done }) }))),
        scanList,
        h('p', { class: 'wl-note' }, t('wallet.addNote')));
    },
  });
}

// ———————————————————————————————————————————————————————————— Wallet settings
function openSettings(env) {
  env.ctx.push({
    title: t('wallet.settings'), className: 'wl-page wl-settings',
    render(body) {
      body.classList.add('wl-body');
      const draw = () => {
        const d = data(), cur = currency();
        const timeIn = h('input', { class: 'wl-time', type: 'time', value: d.prefs.alertTime, 'aria-label': t('wallet.alertTime'), onChange: (e) => { const v = e.target.value || '09:00'; mutate((x) => { x.prefs.alertTime = v; }); } });
        const live = d.passes.filter((p) => !M.isExpired(p));
        const wp = live.find((p) => p.id === d.prefs.widgetPass);
        body.replaceChildren(
          subheader(t('wallet.money')),
          list(
            row({ icon: 'wl-wallet', iconBg: '#22b07d', title: t('wallet.currency'), sub: `${cur} · ${currencyName(cur)}`, onClick: async () => {
              const v = await choose(t('wallet.currency'), currencyList([cur]).map((c) => ({ value: c, label: `${c} · ${currencyName(c)}` })), cur);
              if (v) mutate((x) => { x.prefs.cur = v; });
            } }),
            row({ icon: 'bell', iconBg: '#ff4d6d', title: t('wallet.alertTime'), sub: t('wallet.alertTimeSub'), right: timeIn, className: 'muted-sub' })),
          h('p', { class: 'wl-note' }, t('wallet.currencyNote')),
          subheader(t('wallet.passesSec')),
          list(
            row({ icon: 'widgets', iconBg: '#3e7bff', title: t('wallet.widgetPass'), sub: wp ? passName(wp) : t('wallet.widgetAuto'), onClick: async () => {
              const v = await choose(t('wallet.widgetPass'), [{ value: '', label: t('wallet.widgetAuto'), sub: t('wallet.widgetAutoSub') }, ...live.map((p) => ({ value: p.id, label: passName(p), sub: kindOne(p.kind) }))], d.prefs.widgetPass || '');
              if (v != null) mutate((x) => { if (v) x.prefs.widgetPass = v; else delete x.prefs.widgetPass; });
            } }),
            row({ icon: 'history', iconBg: '#8a8d96', title: t('wallet.expired'), chevron: true, onClick: env.openExpired })));
      };
      draw();
      return onWallet(draw);
    },
  });
}
