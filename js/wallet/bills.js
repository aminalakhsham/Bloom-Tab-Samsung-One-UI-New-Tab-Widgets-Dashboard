// Samsung Wallet › Subscriptions and bills: what you pay for regularly, with the next billing date moving forward by
// itself, the cost per month and per year (one line per currency, as there are no exchange rates offline), what's due
// in the next 30 days, free trials, pausing and cancelling, and alerts before each bill (sent by js/bg/wallet.js even
// with no tab open). Ported from Liquid Tab's wallet-subs.js, laid out as a One UI page with an editor page.
import { h, $, escapeHtml as esc, toUrl } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, locale } from '../core/i18n.js';
import { menu, confirm, choose, sw, list, row, subheader, iconBtn } from '../core/ui.js';
import * as M from './model.js';
import { data, mutate, currency, onWallet } from './data.js';
import { money, moneyLines, currencyList, currencyName, parseAmount } from './money.js';
import { CYCLES, ALERTS, subCat, subCatName, subIconHTML, hydrateSubIcons, whenText, statusText, cycleText, longDate, cnt, passName, kindOne } from './format.js';

let sort = 'date';
const subIco = (s) => ({ icon: subIconHTML(s), iconBg: 'transparent' });
const SORTS = [['date', 'wallet.sort.date'], ['name', 'wallet.sort.name'], ['price', 'wallet.sort.price']];

export function billsView(env, tabs, { open } = {}) {
  const { ctx } = env;
  const sortMenu = (at) => menu(at, SORTS.map(([k, l]) => ({ label: t(l), checked: sort === k, onClick: () => { sort = k; draw(); } })), { align: 'end' });
  let body, page;
  ctx.page({
    title: t('wallet.billsTitle'), className: 'wl-page wl-bills',
    actions: [iconBtn('plus', () => openSub(env), t('wallet.addSub')), iconBtn('more', (e) => menu(e.currentTarget, [
      { label: t('wallet.addSub'), icon: 'plus', onClick: () => openSub(env) },
      { label: t('wallet.sortBy'), icon: 'sort', onClick: () => sortMenu(e.target) },
      '-',
      { label: t('wallet.settings'), icon: 'settings', onClick: env.openSettings },
    ], { align: 'end' }), t('common.more'))],
    render(b, p) {
      body = b;
      page = p;
      page.el.appendChild(tabs);
      body.classList.add('wl-body');
      draw();
      return onWallet(draw);
    },
  });
  if (open) openSub(env, open);

  function rowOf(s, today, up) {
    const right = up
      ? h('span', { class: 'wl-amt2' }, h('b', null, money(up.amount, up.currency)), h('small', null, whenText(up.date, today)))
      : h('span', { class: 'wl-amt2' }, h('b', null, money(s.amount, s.cur)), h('small', null, cycleText(s)));
    const trial = up ? up.trial : M.inTrial(s, today);
    const r = row({ ...subIco(s), title: s.name, sub: up ? (up.trial ? t('wallet.trialEnds') : subCatName(s.cat)) : statusText(s, today) || subCatName(s.cat), right, onClick: () => openSub(env, s.id), className: ['muted-sub', 'wl-srow', s.state !== 'active' && 'dim'].filter(Boolean).join(' ') });
    if (trial) r.querySelector('.ou-row-sub')?.prepend(h('span', { class: 'wl-trial' }, t('wallet.trial')));
    r.dataset.id = s.id;
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); subMenu(e, s); });
    return r;
  }
  function subMenu(at, s) {
    menu(at, [
      { label: t('common.edit'), icon: 'edit', onClick: () => openSub(env, s.id) },
      s.state === 'paused' ? { label: t('wallet.resume'), icon: 'play', onClick: () => setState(s.id, 'active') } : s.state === 'active' ? { label: t('wallet.pause'), icon: 'pause', onClick: () => setState(s.id, 'paused') } : null,
      s.state === 'cancelled' ? { label: t('wallet.reactivate'), icon: 'refresh', onClick: () => setState(s.id, 'active') } : { label: t('wallet.cancelSub'), icon: 'close', onClick: () => cancelSub(s) },
      '-',
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteSub(s) },
    ]);
  }
  function draw() {
    if (!body) return;
    const d = data(), today = M.keyOf(), cur = currency();
    const tot = M.totals(d.subs);
    page.setSubtitle(d.subs.some((s) => s.state === 'active') ? t('wallet.aMonth', { amount: moneyLines(tot.month, cur)[0] || money(0, cur) }) : '');
    if (!d.subs.length) {
      body.replaceChildren(h('div', { class: 'ou-empty' }, h('span', { html: icon('wl-receipt', 56) }), t('wallet.noSubs'), h('small', null, t('wallet.noSubsSub')),
        h('button', { class: 'ou-btn primary', onClick: () => openSub(env) }, t('wallet.addSub'))));
      return;
    }
    const up = M.upcoming(d.subs, 30, today);
    const dueBy = {};
    for (const u of up) dueBy[u.currency] = (dueBy[u.currency] || 0) + u.amount;
    const stat = (label, byCur, foot) => {
      const lines = moneyLines(byCur, cur);
      return h('div', { class: 'wl-stat' }, h('small', null, label), h('b', null, lines[0] || money(0, cur)), ...lines.slice(1, 3).map((x) => h('span', null, x)), foot ? h('span', { class: 'wl-stat-f' }, foot) : null);
    };
    const parts = [h('div', { class: 'ou-card wl-sum' }, stat(t('wallet.perMonth'), tot.month), stat(t('wallet.perYear'), tot.year), stat(t('wallet.next30'), dueBy, cnt('wallet.nBills', up.length)))];
    const seen = new Set(), soon = up.filter((u) => !seen.has(u.id) && seen.add(u.id)).slice(0, 6);
    if (soon.length) parts.push(subheader(t('wallet.upcoming')), list(...soon.map((u) => rowOf(d.subs.find((s) => s.id === u.id), today, u))));
    const sorter = sort === 'name' ? (a, b) => a.name.localeCompare(b.name, locale()) : sort === 'price' ? (a, b) => b.amount * M.perMonth(b) - a.amount * M.perMonth(a) : (a, b) => (M.nextBill(a, today) || '9').localeCompare(M.nextBill(b, today) || '9');
    for (const [state, title] of [['active', 'wallet.active'], ['paused', 'wallet.paused'], ['cancelled', 'wallet.cancelled']]) {
      const ls = d.subs.filter((s) => s.state === state).sort(sorter);
      if (!ls.length) continue;
      const head = h('div', { class: 'wl-sec-head sm' }, h('span', null, t(title)), h('b', null, String(ls.length)));
      if (state === 'active') head.append(h('button', { class: 'wl-viewall', onClick: (e) => sortMenu(e.currentTarget) }, h('span', { html: icon('sort', 16) }), t(SORTS.find((x) => x[0] === sort)[1])));
      parts.push(head, list(...ls.map((s) => rowOf(s, today))));
    }
    parts.push(h('p', { class: 'wl-note' }, t('wallet.totalsNote')));
    body.replaceChildren(...parts);
    hydrateSubIcons(body);
  }
}

function setState(id, state) {
  mutate((d) => { const x = d.subs.find((q) => q.id === id); if (!x) return; x.state = state; if (state !== 'cancelled') delete x.until; });
}
async function cancelSub(s) {
  const until = M.nextBill(s) || M.keyOf();
  if (!(await confirm(t('wallet.cancelQ', { name: s.name }), t('wallet.cancelMsg', { date: longDate(until) }), { okLabel: t('wallet.cancelSub'), danger: true }))) return false;
  mutate((d) => { const x = d.subs.find((q) => q.id === s.id); if (x) { x.state = 'cancelled'; x.until = until; } });
  return true;
}
async function deleteSub(s) {
  if (!(await confirm(t('wallet.deleteSubQ', { name: s.name }), t('wallet.deleteSubMsg'), { okLabel: t('common.delete'), danger: true }))) return false;
  mutate((d) => { d.subs = d.subs.filter((x) => x.id !== s.id); });
  return true;
}

// ———————————————————————————————————————————————————————————— the editor page
export function openSub(env, id) {
  const { ctx } = env;
  const sub = id ? data().subs.find((s) => s.id === id) : null;
  if (id && !sub) return;
  const isNew = !sub, today = M.keyOf();
  const d = sub ? structuredClone(sub) : { name: '', amount: 0, cur: currency(), cycle: 'm', start: today, cat: 'streaming', alert: 1, state: 'active' };
  const next0 = (sub && M.nextBill(sub, today)) || d.start || today;
  let trial = !!(d.trial && d.trial >= today), form;
  const frow = (label, inner, cls = '') => `<label class="wl-frow ${cls}"><span class="wl-frow-l">${esc(label)}</span>${inner}</label>`;
  const pick = (act, label, value) => `<button class="wl-frow wl-frow-btn" data-act="${act}"><span class="wl-frow-l">${esc(label)}</span><span class="wl-frow-v">${value}</span>${icon('down', 18)}</button>`;
  const q = (k) => $(`[data-k="${k}"]`, form);

  function drawForm() {
    const passes = data().passes, pass = passes.find((p) => p.id === d.pass), c = subCat(d);
    form.innerHTML = `<div class="wl-subhero"><span class="wl-subhero-ico"></span><input class="wl-in wl-subhero-name" data-k="name" value="${esc(d.name)}" placeholder="${esc(t('wallet.subName'))}" aria-label="${esc(t('wallet.subName'))}" maxlength="80"></div>
      <div class="ou-card wl-fgroup">
        ${frow(t('wallet.website'), `<input class="wl-in" data-k="url" type="url" value="${esc(d.url || '')}" placeholder="netflix.com" spellcheck="false" aria-label="${esc(t('wallet.website'))}">`)}
        <div class="wl-frow"><span class="wl-frow-l">${esc(t('wallet.price'))}</span><span class="wl-price"><input class="wl-in" data-k="amount" inputmode="decimal" value="${d.amount ? esc(String(d.amount)) : ''}" placeholder="0.00" aria-label="${esc(t('wallet.price'))}"><button class="wl-curbtn" data-act="cur" title="${esc(currencyName(d.cur))}">${esc(d.cur)}</button></span></div>
        ${pick('cycle', t('wallet.cycle'), esc(t(CYCLES[d.cycle])))}
        ${d.cycle === 'd' ? frow(t('wallet.everyDays'), `<input class="wl-in" type="number" min="1" max="3650" data-k="every" value="${esc(d.every || 30)}" aria-label="${esc(t('wallet.everyDays'))}">`) : ''}
      </div>
      <div class="ou-card wl-fgroup">
        <div class="wl-frow wl-trialrow"><span class="wl-frow-l">${esc(t('wallet.freeTrial'))}</span></div>
        ${trial ? frow(t('wallet.trialEnds'), `<input class="wl-in" type="date" data-k="trial" value="${esc(d.trial || M.addDays(today, 7))}">`) : frow(t('wallet.nextBill'), `<input class="wl-in" type="date" data-k="next" value="${esc(d.next || next0)}">`)}
      </div>
      <div class="ou-card wl-fgroup">
        ${pick('cat', t('wallet.category'), `<span class="wl-kdot" style="--c:${c.color}">${icon(c.icon, 16)}</span>${esc(subCatName(d.cat))}`)}
        ${pick('pass', t('wallet.payWith'), esc(pass ? passName(pass) : t('common.none')))}
      </div>
      <div class="ou-subheader">${esc(t('wallet.alerts'))}</div>
      <div class="ou-card wl-fgroup">
        ${pick('alert', t('wallet.alert'), esc(t(ALERTS.find((a) => a[0] === d.alert)?.[1] || 'wallet.al.1')))}
        ${d.alert > 0 ? `<div class="wl-frow wl-ondayrow"><span class="wl-frow-l">${esc(t('wallet.alsoOnDay'))}</span></div>` : ''}
      </div>
      <p class="wl-hint">${esc(t('wallet.alertsHint'))}</p>
      <div class="ou-subheader">${esc(t('wallet.notes'))}</div>
      <div class="ou-card wl-fgroup"><textarea class="wl-in wl-notes" data-k="notes" rows="2" placeholder="${esc(t('wallet.notes'))}" maxlength="2000" aria-label="${esc(t('wallet.notes'))}">${esc(d.notes || '')}</textarea></div>
      ${isNew ? '' : `<div class="ou-card ou-list wl-actions">
        ${d.state !== 'cancelled' ? `<button class="ou-row clickable" data-act="pause"><span class="ou-row-text"><span class="ou-row-title accent">${esc(d.state === 'paused' ? t('wallet.resumeSub') : t('wallet.pauseSub'))}</span></span></button>` : ''}
        <button class="ou-row clickable" data-act="cancel"><span class="ou-row-text"><span class="ou-row-title ${d.state === 'cancelled' ? 'accent' : 'danger'}">${esc(d.state === 'cancelled' ? t('wallet.reactivateSub') : t('wallet.cancelSub'))}</span></span></button>
        <button class="ou-row clickable" data-act="delete"><span class="ou-row-text"><span class="ou-row-title danger">${esc(t('wallet.deleteSub'))}</span></span></button></div>`}`;
    $('.wl-trialrow', form).appendChild(sw(trial, (v) => { keep(); trial = v; drawForm(); }, { label: t('wallet.freeTrial') }));
    $('.wl-ondayrow', form)?.appendChild(sw(!!d.onDay, (v) => { d.onDay = v; }, { label: t('wallet.alsoOnDay') }));
    hero();
  }
  function hero() {
    const u = toUrl(q('url')?.value || '');
    $('.wl-subhero-ico', form).innerHTML = subIconHTML({ ...d, url: u || '' }, 'big');
    hydrateSubIcons(form);
  }
  // what's typed survives a redraw of the form (switching the trial or the cycle)
  function keep() {
    if (!form.firstChild) return;
    d.name = q('name').value;
    d.url = q('url').value;
    const a = parseAmount(q('amount').value);
    d.amount = Number.isFinite(a) ? a : 0;
    if (q('every')) d.every = +q('every').value || 30;
    if (q('trial')) d.trial = q('trial').value;
    if (q('next')) d.next = q('next').value;
    d.notes = q('notes').value;
  }
  async function onClick(e) {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    keep();
    if (act === 'cur') {
      const v = await choose(t('wallet.currency'), currencyList([d.cur]).map((c) => ({ value: c, label: `${c} · ${currencyName(c)}` })), d.cur);
      if (v) d.cur = v;
    } else if (act === 'cycle') {
      const v = await choose(t('wallet.cycle'), Object.entries(CYCLES).map(([value, l]) => ({ value, label: t(l) })), d.cycle);
      if (v) d.cycle = v;
    } else if (act === 'cat') {
      const v = await choose(t('wallet.category'), M.SUB_IDS.map((value) => ({ value, label: subCatName(value), sub: M.SUB_CATS[value].bill ? t('wallet.billCat') : '' })), d.cat);
      if (v) d.cat = v;
    } else if (act === 'pass') {
      const v = await choose(t('wallet.payWith'), [{ value: '', label: t('common.none') }, ...data().passes.map((p) => ({ value: p.id, label: passName(p), sub: kindOne(p.kind) }))], d.pass || '');
      if (v != null) d.pass = v || undefined;
    } else if (act === 'alert') {
      const v = await choose(t('wallet.alert'), ALERTS.map(([value, l]) => ({ value, label: t(l) })), d.alert);
      if (v != null) d.alert = v;
    } else if (act === 'pause') { ctx.pop(); setState(sub.id, sub.state === 'paused' ? 'active' : 'paused'); return; }
    else if (act === 'cancel') { if (sub.state === 'cancelled') { ctx.pop(); setState(sub.id, 'active'); } else if (await cancelSub(sub)) ctx.pop(); return; }
    else if (act === 'delete') { if (await deleteSub(sub)) ctx.pop(); return; }
    drawForm();
  }
  function save() {
    keep();
    const name = d.name.trim(), amount = d.amount;
    if (!name) { q('name').focus(); q('name').classList.add('bad'); return; }
    if (!(amount >= 0) || !Number.isFinite(amount)) { q('amount').focus(); q('amount').classList.add('bad'); return; }
    const u = toUrl(d.url || '');
    const next = d.next || next0;
    const out = M.normSub({
      ...d, name, amount, url: u || '', trial: trial ? d.trial || M.addDays(today, 7) : '',
      // an untouched Next bill keeps the original anchor, so a bill on the 31st stays on the last day of short months
      start: trial ? d.trial || M.addDays(today, 7) : sub && sub.start && next === next0 && d.cycle === sub.cycle ? sub.start : next,
      id: d.id || 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: d.at || Date.now(),
    });
    mutate((x) => { const i = x.subs.findIndex((s) => s.id === out.id); if (i >= 0) x.subs[i] = out; else x.subs.push(out); });
    ctx.pop();
  }

  ctx.push({
    title: isNew ? t('wallet.addSub') : t('wallet.editSub'), hero: false, className: 'wl-page wl-editor wl-subed',
    render(body, page) {
      body.classList.add('wl-body');
      form = h('div', { class: 'wl-ed-form' });
      body.append(form);
      form.addEventListener('click', onClick);
      form.addEventListener('input', (e) => { if (e.target.dataset.k === 'url') hero(); e.target.classList.remove('bad'); });
      page.el.appendChild(h('div', { class: 'wl-edbar' },
        h('button', { class: 'wl-edbar-btn', onClick: () => ctx.pop() }, t('common.cancel')),
        h('button', { class: 'wl-edbar-btn primary', dataset: { act: 'save' }, onClick: save }, t('common.save'))));
      drawForm();
      if (isNew) setTimeout(() => q('name')?.focus(), 380);
    },
  });
}
