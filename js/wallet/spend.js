// Samsung Wallet › Spending: type an expense in one line ("Coffee 3.50", "12 € taxi"), see the week, month or year as
// bars coloured by category, the categories and monthly budgets below, and every expense grouped by day. Expenses can
// be edited, deleted and exported as CSV. Each currency is charted on its own (no exchange rates offline). Ported from
// Liquid Tab's wallet-spend.js, laid out as a One UI page.
import { h, $, $$, escapeHtml as esc, download, pad2 } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtDate, fmtTime, isRtl } from '../core/i18n.js';
import { toast, menu, dialog, confirm, seg, list, row, subheader, iconBtn } from '../core/ui.js';
import * as M from './model.js';
import { data, mutate, currency, onWallet } from './data.js';
import { money, moneyShort, moneyLines, currencyList, currencyName, parseAmount, symbolOf, decimalChar } from './money.js';
import { dayText, spendCat, spendName, pct } from './format.js';

// stacking order of the bar segments: neighbours differ enough in hue, also for colour-blind eyes
const STACK = ['food', 'transport', 'shopping', 'services', 'travel', 'health', 'entertainment', 'other'];
const PAGE = 60;
let period = 'week';
const weekStart = () => { try { return (new Intl.Locale(navigator.language).weekInfo?.firstDay ?? 7) % 7; } catch { return 0; } };
const dkey = (d) => M.keyOf(new Date(d));
const catIco = (id, size = 20) => { const c = spendCat(id); return `<span class="wl-catico" style="--c:${c.color}">${icon(c.icon, size)}</span>`; };

/** Rounded axis maximum and step: 0 / 25 / 50 / 75, 0 / 200 / 400 … */
function niceAxis(max) {
  if (!(max > 0)) return { top: 1, step: 1 };
  const raw = max / 3, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || 10 * p;
  return { top: Math.ceil(max / step) * step, step };
}

export function spendView(env, tabs, { expense } = {}) {
  const { ctx } = env;
  let start = M.periodStart(period, new Date(), weekStart());
  let chartCur = null, pick = null, shown = PAGE, body, page, quick;
  const exportCSV = () => {
    const d = data();
    if (!d.spend.length) { toast(t('wallet.noExpenses')); return; }
    const head = ['date', 'time', 'merchant', 'category', 'amount', 'currency', 'note'].map((k) => t('wallet.csv.' + k));
    download(`${t('wallet.tab.spend')} ${M.keyOf()}.csv`, M.toCSV(d.spend, spendName, head), 'text/csv;charset=utf-8');
  };
  const content = () => body?.querySelector('.wl-spend-content');
  function currencies(d) {
    const n = {};
    for (const e of d.spend) n[e.cur] = (n[e.cur] || 0) + 1;
    return Object.keys(n).sort((a, b) => n[b] - n[a]);
  }
  const range = () => ({ from: start, to: M.periodEnd(period, start) });
  const periodLabel = () => {
    const { from, to } = range();
    if (period === 'year') return fmtDate(from, { year: 'numeric' });
    if (period === 'month') return fmtDate(from, { month: 'long', year: 'numeric' });
    const last = new Date(to - 1);
    return `${fmtDate(from, { month: 'short', day: 'numeric' })} – ${fmtDate(last, { month: 'short', day: 'numeric' })}`;
  };
  const barLabel = (b, i) => (period === 'week' ? fmtDate(b.from, { weekday: 'narrow' }) : period === 'year' ? fmtDate(b.from, { month: 'narrow' }) : i % 7 === 0 ? String(b.from.getDate()) : '');
  const barTitle = (b) => (period === 'year' ? fmtDate(b.from, { month: 'long', year: 'numeric' }) : fmtDate(b.from, { weekday: 'long', month: 'short', day: 'numeric' }));

  function draw() {
    const el = content();
    if (!el) return;
    const d = data(), cur = currency(), curs = currencies(d);
    if (!chartCur || (!curs.includes(chartCur) && chartCur !== cur)) chartCur = curs.includes(cur) || !curs.length ? cur : curs[0];
    const now = new Date();
    const wk = M.weekOf(now, weekStart()), mo = new Date(now.getFullYear(), now.getMonth(), 1);
    const week = M.byCurrency(d.spend, wk, M.periodEnd('week', wk)), month = M.byCurrency(d.spend, mo, M.periodEnd('month', mo));
    page.setSubtitle(d.spend.length ? t('wallet.thisMonthIs', { amount: moneyLines(month, cur)[0] || money(0, cur) }) : '');
    // budgets are monthly and in the default currency
    const budgetTotal = Object.values(d.budgets).reduce((a, b) => a + b, 0);
    const spentCur = M.sumRange(d.spend, mo, M.periodEnd('month', mo), cur);
    const left = budgetTotal - Object.keys(d.budgets).reduce((a, k) => a + (spentCur.cats[k] || 0), 0);
    const tile = (label, byCur, ic, color) => { const l = moneyLines(byCur, cur); return `<div class="wl-tile"><span class="wl-tile-l"><i style="--c:${color}">${icon(ic, 16)}</i>${esc(label)}</span><b class="wl-tile-v">${esc(l[0] || money(0, cur))}</b>${l.slice(1, 2).map((x) => `<small>${esc(x)}</small>`).join('')}</div>`; };
    let html = `<div class="wl-tiles three">${tile(t('wallet.thisWeek'), week, 'calendar', '#ff8a3d')}${tile(t('wallet.thisMonth'), month, 'wl-chart', '#f2556b')}
      <button class="wl-tile" data-act="budgets"><span class="wl-tile-l"><i style="--c:${budgetTotal && left < 0 ? '#e5484d' : '#2fb36b'}">${icon('wl-gauge', 16)}</i>${esc(t('wallet.budget'))}</span>
      ${budgetTotal ? `<b class="wl-tile-v ${left < 0 ? 'over' : ''}">${esc(money(Math.abs(left), cur))}</b><small>${esc(left < 0 ? t('wallet.overBudget') : t('wallet.leftBudget'))}</small>` : `<b class="wl-tile-v cta">${esc(t('wallet.setBudget'))}</b><small>${esc(t('wallet.perCategory'))}</small>`}</button></div>`;
    html += chartHTML(d, curs);
    const bk = STACK.filter((k) => d.budgets[k]);
    if (bk.length) {
      html += `<div class="wl-sec-head sm"><span>${esc(t('wallet.budgets'))}</span><b>${esc(fmtDate(now, { month: 'long' }))}</b><button class="wl-viewall" data-act="budgets">${esc(t('common.edit'))}</button></div><div class="ou-card wl-budgets">${bk.map((k) => {
        const spent = spentCur.cats[k] || 0, b = d.budgets[k], fill = Math.min(1, spent / b), over = spent > b;
        return `<div class="wl-brow">${catIco(k)}<span class="wl-brow-t"><span class="wl-brow-top"><b>${esc(spendName(k))}</b><span class="${over ? 'over' : ''}">${esc(over ? t('wallet.over', { amount: money(spent - b, cur) }) : t('wallet.left', { amount: money(b - spent, cur) }))}</span></span>
          <span class="wl-meter ${over ? 'over' : ''}" role="meter" aria-valuemin="0" aria-valuemax="${b}" aria-valuenow="${spent}" aria-label="${esc(spendName(k))}"><i style="width:${(fill * 100).toFixed(1)}%;--c:${spendCat(k).color}"></i></span>
          <small>${esc(t('wallet.spentOf', { spent: money(spent, cur), budget: money(b, cur) }))}</small></span></div>`;
      }).join('')}</div>`;
    }
    html += transactionsHTML(d);
    el.innerHTML = html;
    const segBox = $('.wl-chart-seg', el);
    if (segBox) segBox.appendChild(seg([{ value: 'week', label: t('wallet.week') }, { value: 'month', label: t('wallet.month') }, { value: 'year', label: t('wallet.year') }], period, (v) => { period = v; start = M.periodStart(v, new Date(), weekStart()); pick = null; draw(); }));
  }

  function chartHTML(d, curs) {
    const cur = chartCur, { from, to } = range();
    const bars = M.bars(d.spend, period, from, cur);
    const sum = M.sumRange(d.spend, from, to, cur);
    const max = Math.max(...bars.map((b) => b.total), 0), ax = niceAxis(max);
    const isNow = new Date() >= from && new Date() < to;
    const ticks = [];
    for (let v = 0; v <= ax.top + 1e-9; v += ax.step) ticks.push(v);
    const today = M.keyOf();
    const cols = bars.map((b, i) => {
      const segs = STACK.filter((k) => b.cats[k] > 0).map((k) => `<i style="--c:${spendCat(k).color};flex-grow:${b.cats[k]}"></i>`).join('');
      const on = pick?.from && !pick.cat && +pick.from === +b.from;
      return `<button class="wl-bar ${on ? 'on' : ''} ${period !== 'year' && dkey(b.from) === today ? 'today' : ''} ${b.total ? '' : 'zero'}" data-i="${i}" aria-label="${esc(barTitle(b))}: ${esc(money(b.total, cur))}"><span class="wl-bar-track"><span class="wl-bar-fill" style="height:${(b.total / ax.top * 100).toFixed(2)}%">${segs}</span></span><span class="wl-bar-l">${esc(barLabel(b, i))}</span></button>`;
    }).join('');
    const cats = STACK.filter((k) => sum.cats[k] > 0).sort((a, b) => sum.cats[b] - sum.cats[a]);
    return `<div class="ou-card wl-chartcard">
      <div class="wl-chart-head"><div class="wl-chart-tt"><small>${esc(t('wallet.spent'))}</small><b>${esc(money(sum.total, cur))}</b><span>${esc(periodLabel())}</span></div>
        <div class="wl-chart-nav"><button class="ou-icon-btn" data-act="prev" aria-label="${esc(t('wallet.prev'))}">${icon('back', 20)}</button>${isNow ? '' : `<button class="ou-btn wl-now" data-act="now">${esc(t('common.today'))}</button>`}<button class="ou-icon-btn" data-act="next" aria-label="${esc(t('wallet.next'))}" ${isNow ? 'disabled' : ''}>${icon('forward', 20)}</button></div></div>
      <div class="wl-chart-ctl"><span class="wl-chart-seg"></span>${curs.length > 1 ? `<select class="ou-input wl-chartcur" data-act="cur" aria-label="${esc(t('wallet.currency'))}">${curs.map((c) => `<option value="${c}" ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}</div>
      <div class="wl-chart p-${period}" role="group" aria-label="${esc(t('wallet.tab.spend'))}">
        <div class="wl-gridlines">${ticks.slice().reverse().map((v) => `<span><em>${esc(moneyShort(v, cur))}</em></span>`).join('')}</div>
        <div class="wl-bars">${cols}</div>
        <div class="wl-tip" hidden></div>
      </div>
      ${cats.length ? `<div class="wl-cats">${cats.map((k) => `<button class="wl-cat ${pick?.cat === k ? 'on' : ''}" data-cat="${k}">${catIco(k, 18)}<span class="wl-cat-t">${esc(spendName(k))}</span><span class="wl-cat-bar"><i style="width:${(sum.cats[k] / sum.total * 100).toFixed(1)}%;--c:${spendCat(k).color}"></i></span><b>${esc(money(sum.cats[k], cur))}</b><small>${esc(pct(sum.cats[k] / sum.total))}</small></button>`).join('')}</div>`
        : `<div class="wl-chart-empty">${esc(t('wallet.noSpendPeriod'))}</div>`}
    </div>`;
  }

  function transactionsHTML(d) {
    let ls = [...d.spend].sort((a, b) => b.at - a.at);
    let head = t('wallet.transactions');
    if (pick) {
      ls = ls.filter((e) => e.at >= +pick.from && e.at < +pick.to && e.cur === chartCur && (!pick.cat || e.cat === pick.cat));
      head = pick.label;
    }
    if (!d.spend.length) return `<div class="ou-empty">${icon('wl-chart', 56)}<span>${esc(t('wallet.noExpenses'))}</span><small>${esc(t('wallet.noExpensesSub'))}</small><button class="ou-btn primary" data-act="new">${esc(t('wallet.addExpense'))}</button></div>`;
    let html = `<div class="wl-sec-head sm"><span>${esc(head)}</span>${pick ? `<button class="wl-viewall" data-act="unpick">${esc(t('wallet.showAll'))}</button>` : ''}</div>`;
    if (!ls.length) return html + `<div class="wl-chart-empty">${esc(t('wallet.noExpensesHere'))}</div>`;
    const days = new Map();
    for (const e of ls.slice(0, shown)) { const k = dkey(e.at); if (!days.has(k)) days.set(k, []); days.get(k).push(e); }
    for (const [k, es] of days) {
      const tot = {};
      for (const e of es) tot[e.cur] = (tot[e.cur] || 0) + e.amt;
      html += `<div class="wl-day"><span>${esc(dayText(k))}</span><span>${esc(moneyLines(tot, currency()).join(' · '))}</span></div><div class="ou-card ou-list">${es.map((e) => `<button class="ou-row clickable wl-erow" data-id="${esc(e.id)}">${catIco(e.cat)}<span class="ou-row-text"><span class="ou-row-title"><bdi>${esc(e.mer || spendName(e.cat))}</bdi></span><span class="ou-row-sub muted">${esc(spendName(e.cat))} · ${esc(fmtTime(new Date(e.at)))}${e.note ? ` · <bdi>${esc(e.note)}</bdi>` : ''}</span></span><span class="wl-amt">${esc(money(e.amt, e.cur))}</span></button>`).join('')}</div>`;
    }
    if (ls.length > shown) html += `<button class="ou-btn wl-moreb" data-act="more-tx">${esc(t('wallet.showMore'))}</button>`;
    return html;
  }

  function onClick(e) {
    const a = e.target.closest('[data-act]');
    const act = a?.dataset.act;
    if (act === 'prev' || act === 'next') { start = M.periodShift(period, start, act === 'prev' ? -1 : 1); pick = null; draw(); return; }
    if (act === 'now') { start = M.periodStart(period, new Date(), weekStart()); pick = null; draw(); return; }
    if (act === 'budgets') return openBudgets();
    if (act === 'new') return openExpense(null);
    if (act === 'unpick') { pick = null; draw(); return; }
    if (act === 'more-tx') { shown += PAGE; draw(); return; }
    const bar = e.target.closest('.wl-bar');
    if (bar) {
      const b = M.bars(data().spend, period, start, chartCur)[+bar.dataset.i];
      pick = pick?.from && !pick.cat && +pick.from === +b.from ? null : { from: b.from, to: b.to, label: barTitle(b) };
      draw();
      return;
    }
    const c = e.target.closest('.wl-cat');
    if (c) { const { from, to } = range(); pick = pick?.cat === c.dataset.cat ? null : { from, to, cat: c.dataset.cat, label: `${spendName(c.dataset.cat)} · ${periodLabel()}` }; draw(); return; }
    const r = e.target.closest('.wl-erow');
    if (r) openExpense(data().spend.find((x) => x.id === r.dataset.id));
  }
  // the bar under the pointer (or keyboard focus) shows its total and categories
  function tip(bar) {
    const el = content(), tipEl = el && $('.wl-tip', el);
    if (!tipEl) return;
    if (!bar) { tipEl.hidden = true; return; }
    const b = M.bars(data().spend, period, start, chartCur)[+bar.dataset.i];
    const cats = STACK.filter((k) => b.cats[k] > 0).sort((x, y) => b.cats[y] - b.cats[x]);
    tipEl.innerHTML = `<b>${esc(barTitle(b))}</b><span class="wl-tip-tot">${esc(money(b.total, chartCur))}</span>${cats.slice(0, 5).map((k) => `<span class="wl-tip-row"><i style="--c:${spendCat(k).color}"></i>${esc(spendName(k))}<em>${esc(money(b.cats[k], chartCur))}</em></span>`).join('')}`;
    tipEl.hidden = false;
    const chart = bar.closest('.wl-chart'), cr = chart.getBoundingClientRect(), br = bar.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    tipEl.style.left = Math.max(0, Math.min(cr.width - w, br.left + br.width / 2 - cr.left - w / 2)) + 'px';
  }

  function quickAdd() {
    const text = quick.value.trim();
    if (!text) { openExpense(null); return; }
    const p = M.parseExpense(text, { currency: currency(), decimal: decimalChar() });
    if (!p) { quick.classList.remove('shake'); void quick.offsetWidth; quick.classList.add('shake'); toast(t('wallet.quickNeedsAmount')); return; }
    const x = M.normExpense({ id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), amt: p.amount, cur: p.currency, mer: p.merchant, cat: p.category, at: p.at });
    mutate((d) => d.spend.push(x));
    quick.value = '';
    toast(`${x.mer || spendName(x.cat)} · ${money(x.amt, x.cur)}`, { action: t('common.undo'), onAction: () => mutate((d) => { d.spend = d.spend.filter((y) => y.id !== x.id); }) });
  }

  // the expense dialog: amount first, then merchant, category, date and a note
  async function openExpense(x) {
    const isNew = !x;
    const d = x ? { ...x } : { amt: 0, cur: currency(), mer: '', cat: '', at: Date.now(), note: '' };
    let catPicked = !!x;
    const at = new Date(d.at), local = `${M.keyOf(at)}T${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
    const amt = h('input', { class: 'wl-exed-in', inputmode: 'decimal', value: d.amt ? String(d.amt) : '', placeholder: '0.00', 'aria-label': t('wallet.amount') });
    const curSel = h('select', { class: 'wl-exed-cur', 'aria-label': t('wallet.currency') }, currencyList([d.cur]).map((c) => h('option', { value: c, selected: c === d.cur, title: currencyName(c) }, symbolOf(c) === c ? c : `${symbolOf(c)} ${c}`)));
    const mer = h('input', { class: 'ou-input', value: d.mer, placeholder: t('wallet.merchantPh'), maxlength: 80, 'aria-label': t('wallet.merchant') });
    const when = h('input', { class: 'ou-input', type: 'datetime-local', value: local, 'aria-label': t('wallet.date') });
    const note = h('input', { class: 'ou-input', value: d.note || '', placeholder: t('wallet.notePh'), maxlength: 300, 'aria-label': t('wallet.note') });
    const grid = h('div', { class: 'wl-catgrid', role: 'radiogroup', 'aria-label': t('wallet.category') }, M.SPEND_IDS.map((k) =>
      h('button', { class: ['wl-catpick', d.cat === k && 'on'], role: 'radio', 'aria-checked': String(d.cat === k), dataset: { cat: k }, onClick: () => { catPicked = true; pickCat(k); } },
        h('span', { html: catIco(k) }), h('span', null, spendName(k)))));
    const pickCat = (k) => { d.cat = k; $$('.wl-catpick', grid).forEach((b) => { const on = b.dataset.cat === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); };
    // the category follows the merchant ("Uber" → Transport) until one is picked
    mer.addEventListener('input', () => { if (!catPicked) pickCat(M.guessCategory(mer.value)); });
    const actions = [{ label: t('common.cancel'), value: null }];
    if (!isNew) actions.push({ label: t('common.delete'), value: 'delete', danger: true });
    actions.push({ label: isNew ? t('common.add') : t('common.save'), value: 'save', primary: true, validate: () => { const v = parseAmount(amt.value); if (v > 0) return true; amt.classList.add('bad'); amt.focus(); return false; } });
    const res = await dialog({
      title: isNew ? t('wallet.addExpense') : t('wallet.expense'), className: 'wl-exdialog',
      content: h('div', { class: 'wl-exed' }, h('div', { class: 'wl-exed-amt' }, amt, curSel), mer, grid, when, note),
      actions,
    });
    if (res === 'delete') { await delExpense(x); return; }
    if (res !== 'save') return;
    const out = M.normExpense({ id: d.id || 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), amt: parseAmount(amt.value), cur: curSel.value, mer: mer.value.trim(), cat: d.cat || M.guessCategory(mer.value), at: +new Date(when.value) || Date.now(), note: note.value.trim() });
    mutate((s) => { const i = s.spend.findIndex((e) => e.id === out.id); if (i >= 0) s.spend[i] = out; else s.spend.push(out); });
  }
  async function delExpense(x) {
    if (!x || !(await confirm(t('wallet.deleteExpenseQ'), `${x.mer || spendName(x.cat)} · ${money(x.amt, x.cur)}`, { okLabel: t('common.delete'), danger: true }))) return;
    mutate((d) => { d.spend = d.spend.filter((e) => e.id !== x.id); });
  }

  async function openBudgets() {
    const d = data(), cur = currency();
    const inputs = {};
    const box = h('div', { class: 'wl-buded' }, STACK.map((k) => h('label', { class: 'wl-bud' }, h('span', { html: catIco(k) }), h('span', { class: 'wl-bud-t' }, spendName(k)), h('span', { class: 'wl-bud-sym' }, symbolOf(cur)),
      (inputs[k] = h('input', { class: 'ou-input', inputmode: 'decimal', value: d.budgets[k] ? String(d.budgets[k]) : '', placeholder: t('common.none'), 'aria-label': spendName(k) })))),
      h('p', { class: 'wl-hint' }, t('wallet.budgetsNote', { currency: currencyName(cur) })));
    const res = await dialog({ title: t('wallet.budgets'), className: 'wl-buddialog', content: box, actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: true, primary: true }] });
    if (!res) return;
    const b = {};
    for (const [k, i] of Object.entries(inputs)) { const v = parseAmount(i.value); if (v > 0) b[k] = Math.round(v * 100) / 100; }
    mutate((x) => { x.budgets = b; });
  }

  ctx.page({
    title: t('wallet.tab.spend'), className: 'wl-page wl-spend',
    actions: [iconBtn('plus', () => openExpense(null), t('wallet.addExpense')), iconBtn('more', (e) => menu(e.currentTarget, [
      { label: t('wallet.addExpense'), icon: 'plus', onClick: () => openExpense(null) },
      { label: t('wallet.budgets'), icon: 'wl-gauge', onClick: openBudgets },
      { label: t('wallet.exportCsv'), icon: 'download', onClick: exportCSV },
      '-',
      { label: t('wallet.settings'), icon: 'settings', onClick: env.openSettings },
    ], { align: 'end' }), t('common.more'))],
    render(b, p) {
      body = b;
      page = p;
      page.el.appendChild(tabs);
      body.classList.add('wl-body');
      // quick entry: "Coffee 3.50" (the field lives outside the redrawn part, so typing survives a redraw)
      quick = h('input', { class: 'wl-quick-in', enterkeyhint: 'done', placeholder: t('wallet.quickPh'), 'aria-label': t('wallet.addExpense'), spellcheck: 'false' });
      const form = h('form', { class: 'ou-searchbox wl-quick', autocomplete: 'off', onSubmit: (e) => { e.preventDefault(); quickAdd(); } },
        h('span', { html: icon('plus', 20) }), quick, h('button', { class: 'wl-quick-go', type: 'submit', 'aria-label': t('common.add'), html: icon('up', 20) }));
      const content = h('div', { class: 'wl-spend-content' });
      body.append(form, content);
      content.addEventListener('click', onClick);
      content.addEventListener('change', (e) => { if (e.target.dataset.act === 'cur') { chartCur = e.target.value; pick = null; draw(); } });
      content.addEventListener('pointerover', (e) => tip(e.target.closest('.wl-bar')));
      content.addEventListener('pointerleave', () => tip(null));
      content.addEventListener('focusin', (e) => tip(e.target.closest('.wl-bar')));
      content.addEventListener('focusout', () => tip(null));
      content.addEventListener('keydown', (e) => {
        const bar = e.target.closest?.('.wl-bar');
        if (!bar || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        const all = $$('.wl-bar', content), i = all.indexOf(bar), fwd = (e.key === 'ArrowRight') !== isRtl();
        all[Math.max(0, Math.min(all.length - 1, i + (fwd ? 1 : -1)))]?.focus();
        e.preventDefault();
      });
      draw();
      if (expense) setTimeout(() => openExpense(null), 60);
      return onWallet(draw);
    },
  });
}
