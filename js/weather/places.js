// Manage locations (One UI): a card per place over its own sky (the first one is the main location used by the
// widgets and the Lock screen), tap to show it, long-press or Edit for selection mode with checkboxes, Delete in the
// bottom bar and drag handles to reorder; "+" opens the search, where a result opens a preview of that city's
// weather with Add. `app` is the main screen's interface: { dataOf(p), load(p), show(id), placeView(body, p, d) }.
import { h, debounce, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { iconBtn, menu, toast, btn } from '../core/ui.js';
import {
  HERE, MAX_PLACES, places, setPlaces, addPlace, removePlaces, setUseCurrent, searchCities, fetchForecast, placeName, weatherInfo, fmtTemp,
} from '../services/weather.js';
import { store } from '../core/store.js';
import { cityId, samePlace, todayIdx, skyPhase } from './model.js';
import { skyHTML } from './sky.js';
import { fmtFor, otherZone } from './cards.js';

const toRoot = (ctx) => {
  while (ctx.depth > 1) ctx.pop();
};

/** A location card (Manage locations). */
function cardEl(p, d, i, { editing, checked }) {
  const f = d ? fmtFor(d) : null, today = d ? d.daily[todayIdx(d)] : null;
  const sub = i === 0 ? t('wx.main') : p.id === HERE ? '' : d && otherZone(d) ? f.time(Date.now()) : [p.region, p.country].filter(Boolean).join(', ');
  const name = h('b', { class: 'wx-pc-name' }, p.id === HERE ? h('span', { html: icon('navigation', 14) }) : null, h('span', null, placeName(p, d)));
  return h('div', { class: ['wx-pcard', editing && 'editing', checked && 'checked', i === 0 && 'main'], dataset: { id: p.id }, role: 'listitem' },
    h('div', { class: 'wx-pc-sky', html: skyHTML({ code: d?.current?.code ?? 2, phase: d ? skyPhase(d) : 'day', mini: true, seed: p.id, lat: d?.location?.lat ?? 0 }) }),
    editing ? h('label', { class: 'wx-pcheck' }, h('input', { type: 'checkbox', checked: !!checked, 'aria-label': placeName(p, d), dataset: { check: p.id } }), h('span', { class: 'wx-pcheck-box', html: icon('check', 16) })) : null,
    h('button', { class: 'wx-pc-main', dataset: { open: p.id } },
      h('span', { class: 'wx-pc-l' }, name, sub ? h('span', { class: 'wx-pc-sub' }, sub) : null, h('span', { class: 'wx-pc-cond' }, d ? weatherInfo(d.current.code, d.current.isDay).label : t('wx.loading'))),
      h('span', { class: 'wx-pc-r' },
        d ? h('span', { class: 'wx-pc-ico', html: weatherInfo(d.current.code, d.current.isDay).icon }) : null,
        h('span', { class: 'wx-pc-temp' }, d ? fmtTemp(d.current.temp) : '--°'),
        today ? h('span', { class: 'wx-pc-hl' }, `${fmtTemp(today.max)} / ${fmtTemp(today.min)}`) : null)),
    editing ? h('span', { class: 'wx-pgrip', tabindex: 0, role: 'button', 'aria-label': t('wx.reorder'), title: t('wx.reorder'), dataset: { grip: p.id }, html: icon('wx-grip', 22) }) : null);
}

export function openPlaces(ctx, app) {
  let editing = false;
  const sel = new Set();
  const addBtn = iconBtn('plus', () => openSearch(ctx, app), t('wx.addLocation'));
  const moreBtn = iconBtn('more', (e) => menu(e.currentTarget, [
    { label: t('common.edit'), icon: 'edit', onClick: () => setEditing(true) },
    { label: t('wx.addLocation'), icon: 'plus', onClick: () => openSearch(ctx, app) },
  ], { align: 'end' }), t('common.more'));
  const doneBtn = h('button', { class: 'ou-btn wx-done' }, t('common.done'));
  doneBtn.addEventListener('click', () => setEditing(false));
  let page, listEl, bar, delBtn, allBox;

  const draw = () => {
    const list = places();
    for (const id of [...sel]) if (!list.some((p) => p.id === id)) sel.delete(id);
    listEl.replaceChildren(...list.map((p, i) => cardEl(p, app.dataOf(p), i, { editing, checked: sel.has(p.id) })));
    if (editing) {
      page.setTitle(sel.size ? t('wx.nSelected', { n: sel.size }) : t('wx.selectLocations'));
      delBtn.disabled = !sel.size;
      allBox.checked = sel.size === list.length;
    }
  };
  function setEditing(on, first) {
    editing = on;
    sel.clear();
    if (first) sel.add(first);
    page.el.classList.toggle('editing', on);
    page.setTitle(on ? t('wx.selectLocations') : t('wx.manage'));
    page.setActions(on ? [doneBtn] : [addBtn, moreBtn]);
    bar.hidden = !on;
    draw();
  }
  function remove(ids) {
    if (ids.length >= places().length) return toast(t('wx.keepOne'));
    removePlaces(ids);
    toast(t('wx.deleted'));
    setEditing(false);
  }
  const move = (id, to) => {
    const list = places(), i = list.findIndex((p) => p.id === id);
    if (i < 0 || to < 0 || to >= list.length) return;
    const [x] = list.splice(i, 1);
    list.splice(to, 0, x);
    setPlaces(list);
  };

  page = ctx.push({
    title: t('wx.manage'),
    hero: true,
    className: 'wx-ppage',
    actions: [addBtn, moreBtn],
    render(body, pg) {
      page = pg;
      ctx.win.style.background = '';
      listEl = h('div', { class: 'wx-plist', role: 'list' });
      allBox = h('input', { type: 'checkbox', 'aria-label': t('wx.all') });
      delBtn = h('button', { class: 'wx-pbar-btn', disabled: true }, h('span', { html: icon('trash', 22) }), h('span', null, t('common.delete')));
      bar = h('div', { class: 'wx-pbar', hidden: true },
        h('label', { class: 'wx-pall' }, allBox, h('span', { class: 'wx-pcheck-box', html: icon('check', 16) }), h('span', null, t('wx.all'))), delBtn);
      pg.el.append(bar);
      body.append(h('p', { class: 'wx-phint' }, t('wx.mainHint')), listEl);
      allBox.addEventListener('change', () => {
        sel.clear();
        if (allBox.checked) places().forEach((p) => sel.add(p.id));
        draw();
      });
      delBtn.addEventListener('click', () => remove([...sel]));
      listEl.addEventListener('change', (e) => {
        const c = e.target.closest('[data-check]');
        if (!c) return;
        if (c.checked) sel.add(c.dataset.check);
        else sel.delete(c.dataset.check);
        draw();
      });
      listEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-open]');
        if (!b) return;
        if (editing) {
          const id = b.dataset.open;
          if (sel.has(id)) sel.delete(id);
          else sel.add(id);
          return draw();
        }
        app.show(b.dataset.open);
        ctx.pop();
      });
      listEl.addEventListener('contextmenu', (e) => {
        const card = e.target.closest('.wx-pcard');
        if (!card || editing) return;
        e.preventDefault();
        const id = card.dataset.id, list = places(), i = list.findIndex((p) => p.id === id);
        menu(e, [
          i > 0 && { label: t('wx.setMain'), icon: 'home', onClick: () => move(id, 0) },
          i > 0 && { label: t('wx.moveUp'), icon: 'up', onClick: () => move(id, i - 1) },
          i < list.length - 1 && { label: t('wx.moveDown'), icon: 'down', onClick: () => move(id, i + 1) },
          '-',
          { label: t('common.edit'), icon: 'edit', onClick: () => setEditing(true, id) },
          { label: t('common.delete'), icon: 'trash', danger: true, disabled: list.length < 2, onClick: () => remove([id]) },
        ]);
      });
      // long-press a card: selection mode with it checked (One UI)
      const offLong = onLongPress(listEl, (e) => {
        const card = e.target.closest?.('.wx-pcard');
        if (card && !editing) setEditing(true, card.dataset.id);
      });
      // drag the handle to reorder; arrow keys on a focused handle move it too
      listEl.addEventListener('pointerdown', (e) => {
        const grip = e.target.closest('[data-grip]');
        if (!grip || !editing || e.button) return;
        e.preventDefault();
        const card = grip.closest('.wx-pcard');
        grip.setPointerCapture(e.pointerId);
        card.classList.add('dragging');
        const y0 = e.clientY, top0 = card.offsetTop;
        const mv = (ev) => {
          for (const s of [...listEl.children]) {
            if (s === card) continue;
            const r = s.getBoundingClientRect(), mid = r.top + r.height / 2;
            const before = card.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING;
            if (before && ev.clientY < mid) {
              listEl.insertBefore(card, s);
              break;
            }
            if (!before && ev.clientY > mid) {
              s.after(card);
              break;
            }
          }
          card.style.transform = `translateY(${(ev.clientY - y0 - (card.offsetTop - top0)).toFixed(0)}px)`;
        };
        const up = () => {
          grip.removeEventListener('pointermove', mv);
          grip.removeEventListener('pointerup', up);
          grip.removeEventListener('pointercancel', up);
          card.classList.remove('dragging');
          card.style.transform = '';
          const by = Object.fromEntries(places().map((p) => [p.id, p]));
          const order = [...listEl.children].map((c) => by[c.dataset.id]).filter(Boolean);
          if (order.map((p) => p.id).join() !== places().map((p) => p.id).join()) setPlaces(order);
          else draw();
        };
        grip.addEventListener('pointermove', mv);
        grip.addEventListener('pointerup', up);
        grip.addEventListener('pointercancel', up);
      });
      listEl.addEventListener('keydown', (e) => {
        const grip = e.target.closest('[data-grip]');
        if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const id = grip.dataset.grip, i = places().findIndex((p) => p.id === id);
        move(id, i + (e.key === 'ArrowUp' ? -1 : 1));
        listEl.querySelector(`[data-grip="${CSS.escape(id)}"]`)?.focus();
      });
      draw();
      // forecasts missing or older than 30 minutes are loaded, a couple at a time
      const queue = places().filter((p) => !app.dataOf(p) || Date.now() - app.dataOf(p).fetchedAt > 30 * 60e3);
      const worker = async () => {
        while (queue.length && pg.el.isConnected) {
          await app.load(queue.shift());
          if (pg.el.isConnected) draw();
        }
      };
      setTimeout(() => (worker(), worker()), 50);
      const offs = ['weather', 'weatherMore', 'weatherPlaces'].map((k) => store.on(k, () => draw()));
      return () => {
        offLong();
        offs.forEach((f) => f());
      };
    },
  });
  page.onReturn = () => {
    ctx.win.style.background = '';
    draw();
  };
  return page;
}

/** The search page: type a city, pick a result to preview it. */
export function openSearch(ctx, app) {
  const pg = ctx.push({
    title: t('wx.addLocation'),
    hero: false,
    className: 'wx-spage',
    render(body) {
      ctx.win.style.background = '';
      const input = h('input', { type: 'search', placeholder: t('wx.searchCity'), autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': t('wx.searchCity') });
      const results = h('div', { class: 'wx-sresults' });
      const base = () => {
        const rows = [];
        if (!places().some((p) => p.id === HERE)) {
          rows.push(h('div', { class: 'ou-card ou-list' }, h('button', { class: ['ou-row', 'clickable', 'wx-scur'], onClick: () => {
            setUseCurrent(true);
            app.show(HERE);
            toRoot(ctx);
          } }, h('span', { class: 'ou-row-ico', html: icon('navigation', 20) }), h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('wx.useCurrent')), h('span', { class: 'ou-row-sub' }, t('wx.useCurrentSub'))))));
        }
        rows.push(h('p', { class: 'wx-shint' }, t('wx.searchHint')));
        results.replaceChildren(...rows);
      };
      let seq = 0;
      const run = debounce(async () => {
        const q = input.value.trim(), my = ++seq;
        if (q.length < 2) return base();
        let list;
        try {
          list = await searchCities(q);
        } catch {
          if (my !== seq) return;
          results.replaceChildren(h('div', { class: 'ou-empty wx-sempty' }, t('wx.searchFailed')));
          return toast(t('wx.err.network'));
        }
        if (my !== seq) return;
        results.replaceChildren(list.length ? h('div', { class: 'ou-card ou-list' }, list.map((c) => h('button', { class: ['ou-row', 'clickable', 'wx-sres'], onClick: () => openPreview(ctx, app, c) },
          h('span', { class: 'ou-row-ico', html: icon('location', 20) }),
          h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, c.name), h('span', { class: 'ou-row-sub' }, [c.region, c.country].filter(Boolean).join(', ')))))) : h('div', { class: 'ou-empty wx-sempty' }, t('wx.noResults')));
      }, 280);
      input.addEventListener('input', run);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') results.querySelector('.wx-sres')?.click();
      });
      body.append(h('label', { class: 'ou-searchbox' }, h('span', { html: icon('search', 20) }), input), results);
      base();
      setTimeout(() => input.focus(), 350);
    },
  });
  pg.onReturn = () => (ctx.win.style.background = '');
}

/** A city's weather before it's added, with Add in the toolbar. */
export function openPreview(ctx, app, city) {
  const list = places();
  const dup = list.find((p) => p.id !== HERE && samePlace(p, city));
  if (dup) {
    toast(t('wx.already', { name: dup.name }));
    app.show(dup.id);
    return toRoot(ctx);
  }
  if (list.filter((p) => p.id !== HERE).length >= MAX_PLACES) return toast(t('wx.max', { n: MAX_PLACES }));
  const p = { id: cityId(city.lat, city.lon), name: city.name, region: city.region, country: city.country, lat: city.lat, lon: city.lon };
  let data = null;
  const add = btn(t('wx.add'), () => {
    const placed = addPlace(p, data);
    toast(t('wx.added', { name: p.name }));
    app.show(placed.id);
    toRoot(ctx);
  }, 'wx-addbtn');
  ctx.push({
    title: p.name,
    hero: false,
    className: 'wx-page wx-prev',
    actions: [add],
    render(body, page) {
      app.placeView(page, p, null, { loading: true });
      fetchForecast({ ...p, auto: false }).then((d) => {
        data = d;
        if (page.el.isConnected) app.placeView(page, p, d);
      }, () => page.el.isConnected && app.placeView(page, p, null, { error: { error: 'network', message: t('wx.err.network') } }));
    },
  });
}
