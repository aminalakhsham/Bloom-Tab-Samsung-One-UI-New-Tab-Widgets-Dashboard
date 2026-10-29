// Contacts app window (Samsung Contacts, One UI): the list pane with the large "Contacts" title and count, the
// navigation drawer (≡: groups, Manage contacts, Recycle bin, settings), search across every field, My profile,
// Favourites, the A–Z sections with the fast-scroll letter index (the UI language's alphabet first), long-press /
// right-click selection with Share, Add to group and Delete, and the contact detail and editor. A wide window shows
// two panes (list + detail/editor); a narrow one pushes the detail and editor as pages, like the phone app.
import { h, escapeHtml, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { currentApp } from '../core/apps.js';
import { store } from '../core/store.js';
import { addStrings, t, lang, locale } from '../core/i18n.js';
import { toast, menu, dialog, iconBtn } from '../core/ui.js';
import { listBlobs, delBlob } from '../core/blobs.js';
import * as M from './model.js';
import * as O from './organize.js';
import { data, mutate } from './data.js';
import { avatarHTML, hydrate, contactName, countText } from './format.js';
import { drawDetail } from './detail.js';
import { makeEditor } from './edit.js';
import { openGroup, createGroup, pickGroups, openManage, openBin, openSettings } from './pages.js';
import { importFiles, exportContacts, shareContacts } from './files.js';

export function render(ctx) {
  const page = ctx.page({ title: t('app.contacts'), hero: false, className: 'ct-page' });
  page.body.classList.add('flush');

  let sel = null; // the contact shown in the detail pane (wide windows)
  let pane = null; // { kind: 'edit', editor } while the detail pane holds the editor
  let query = '';
  let picked = null; // Set of ids while selecting
  let order = []; // ids in list order (keyboard navigation)
  let letters = []; // section letters present
  let idxAll = [];

  // ---------------------------------------------------------------- the list pane
  const heroTitle = h('h1', { class: 'ct-hero-title' }, t('app.contacts'));
  const heroSub = h('div', { class: 'ct-hero-sub' });
  const hero = h('div', { class: 'ct-hero' }, heroTitle, heroSub);
  const listEl = h('div', { class: 'ct-list', role: 'list' });
  const scroller = h('div', { class: 'ct-scroll scroll' }, hero, listEl);
  const barTitle = h('div', { class: 'ct-bar-title' }, t('app.contacts'));
  const bar = h('div', { class: 'ct-bar' },
    iconBtn('ctMenu', () => openDrawer(), t('contacts.menu')),
    barTitle,
    iconBtn('plus', () => app.editContact(null), t('contacts.create')),
    iconBtn('search', () => startSearch(), t('common.search')));
  const input = h('input', { type: 'search', class: 'ct-search-in', placeholder: t('common.search'), 'aria-label': t('common.search'), spellcheck: 'false', autocomplete: 'off' });
  const sbar = h('div', { class: 'ct-sbar' }, iconBtn('back', () => stopSearch(), t('common.back')), h('label', { class: 'ou-searchbox ct-searchbox' }, h('span', { html: icon('search', 20) }), input));
  const allBox = h('input', { type: 'checkbox', class: 'ct-allbox', 'aria-label': t('contacts.selectAll') });
  const selCount = h('div', { class: 'ct-selcount' });
  const selbar = h('div', { class: 'ct-selbar' },
    h('label', { class: 'ct-all' }, allBox, h('span', { class: 'ct-check' }), h('span', null, t('contacts.selectAll'))),
    selCount,
    iconBtn('close', () => stopSelect(), t('common.cancel')));
  const selActs = h('div', { class: 'ct-selacts' },
    actBtn('share', t('contacts.share'), () => picked?.size && shareContacts([...picked])),
    actBtn('ctGroup', t('contacts.addToGroup'), () => picked?.size && pickGroups(app, [...picked], { add: true })),
    actBtn('trash', t('contacts.delete'), () => picked?.size && app.deleteContacts([...picked])));
  const index = h('nav', { class: 'ct-index', 'aria-label': t('contacts.index') });
  const bubble = h('div', { class: 'ct-bubble', 'aria-hidden': 'true' });
  const listPane = h('section', { class: 'ct-listpane' }, bar, sbar, selbar, scroller, index, bubble, selActs);
  const detailPane = h('section', { class: 'ct-detailpane' });
  const fileIn = h('input', { type: 'file', class: 'ct-file', accept: '.vcf,.vcard,text/vcard,text/x-vcard', multiple: true, hidden: true });
  const root = h('div', { class: 'ct' }, listPane, detailPane, fileIn);
  page.body.appendChild(root);

  function actBtn(ic, label, onClick) {
    return h('button', { class: 'ct-selact', onClick }, h('span', { html: icon(ic, 22) }), h('span', null, label));
  }

  // One UI's collapsing large title: the hero fades as the list scrolls and the small title appears in the bar.
  scroller.addEventListener('scroll', () => {
    const p = Math.min(1, scroller.scrollTop / (hero.offsetHeight * 0.6 || 1));
    listPane.style.setProperty('--collapse', p.toFixed(3));
    bar.classList.toggle('scrolled', scroller.scrollTop > hero.offsetHeight - 30);
  }, { passive: true });

  // ---------------------------------------------------------------- the controller the other modules use
  const isWide = () => root.classList.contains('wide');
  const app = {
    ctx,
    root,
    isWide,
    /** Shows a contact: in the detail pane (wide) or as a pushed page (narrow). */
    openContact(id, { push = true } = {}) {
      if (!M.byId(data(), id)) return;
      if (isWide()) {
        if (pane?.kind === 'edit' && !pane.editor.leave()) return;
        while (ctx.depth > 1) ctx.pop();
        sel = id;
        markActive();
        drawPane();
        return;
      }
      if (!push) return;
      ctx.push({
        title: contactName(M.byId(data(), id), data().prefs.order),
        hero: false,
        className: 'ct-dpage',
        render(body, p) {
          // a contact deleted or merged away closes its page (only when it is the top page: the shell pops the top one)
          const draw = () => {
            if (!drawDetail(body, id, app, { page: p }) && !p.el.nextElementSibling) ctx.pop();
          };
          draw();
          return store.on(M.KEY, draw);
        },
      });
    },
    /** Opens the editor for a contact, or Create contact with id null ({ me, group } preset a new one). */
    editContact(id, opts = {}) {
      const c = id ? M.byId(data(), id) : null;
      if (id && !c) return;
      const onSave = (out, groups) => {
        mutate((d) => {
          const i = d.items.findIndex((x) => x.id === out.id);
          if (i >= 0) d.items[i] = out;
          else d.items.push(out);
          for (const g of d.groups) {
            const has = g.ids.includes(out.id);
            if (groups.has(g.id) && !has) g.ids.push(out.id);
            if (!groups.has(g.id) && has) g.ids = g.ids.filter((x) => x !== out.id);
          }
          if (opts.me) d.me = out.id;
          if (opts.fav && !d.favs.includes(out.id)) d.favs.push(out.id);
        });
        toast(t('contacts.saved'));
        return out.id;
      };
      if (isWide()) {
        if (pane?.kind === 'edit' && !pane.editor.leave()) return;
        while (ctx.depth > 1) ctx.pop();
        const editor = makeEditor(c, {
          ...opts,
          onSave: (out, groups) => {
            pane = null;
            sel = onSave(out, groups);
            refresh();
          },
          onCancel: () => {
            pane = null;
            drawPane();
          },
        });
        pane = { kind: 'edit', editor };
        detailPane.replaceChildren(editor.el);
        editor.focus();
        return;
      }
      ctx.push({
        title: c ? t('contacts.editTitle') : opts.me ? t('contacts.myProfile') : t('contacts.create'),
        hero: false,
        className: 'ct-epage',
        render(body, p) {
          const editor = makeEditor(c, {
            ...opts,
            onSave: (out, groups) => {
              const newId = onSave(out, groups);
              ctx.pop();
              if (!c) setTimeout(() => app.openContact(newId), 340);
            },
            onCancel: () => ctx.pop(),
          });
          body.appendChild(editor.el);
          // the back arrow asks before throwing changes away, like the editor's Cancel
          p.el.addEventListener('click', (e) => {
            if (!e.target.closest('.app-back')) return;
            e.stopPropagation();
            editor.cancel();
          }, true);
          editor.focus();
          return () => editor.dispose();
        },
      });
    },
    /** Moves contacts to the Recycle bin after asking, like One UI. */
    async deleteContacts(ids) {
      const n = ids.length;
      if (!n) return false;
      const ok = await dialog({
        message: n === 1 ? t('contacts.deleteQ1') : t('contacts.deleteQn', { n }),
        actions: [{ label: t('common.cancel'), value: false }, { label: t('contacts.moveToBin'), value: true, danger: true }],
      });
      if (!ok) return false;
      const next = isWide() && ids.includes(sel) ? order.find((id) => !ids.includes(id) && order.indexOf(id) > order.indexOf(sel)) || order.filter((id) => !ids.includes(id)).at(-1) : sel;
      mutate((d) => O.trashContacts(d, ids));
      if (picked) stopSelect();
      if (pane?.kind === 'edit' && ids.includes(sel)) pane = null;
      sel = next || null;
      refresh(); // a pushed detail page closes itself when its contact is gone
      toast(n === 1 ? t('contacts.binned1') : t('contacts.binnedN', { n }));
      return true;
    },
    startSelect: (id) => startSelect(id),
    stopSelect: () => picked && stopSelect(),
    importFiles: () => fileIn.click(),
    refresh: () => refresh(),
  };

  // ---------------------------------------------------------------- drawing the list
  function rowHTML(c, { sub = '', big = false, name } = {}) {
    const d = data(), on = c.id === sel && isWide() && !picked;
    const nm = name ?? escapeHtml(contactName(c, d.prefs.order));
    return `<div class="ct-row ${big ? 'big' : ''} ${on ? 'on' : ''} ${picked?.has(c.id) ? 'picked' : ''}" data-id="${escapeHtml(c.id)}" role="listitem" tabindex="-1">`
      + (picked ? '<span class="ct-check" aria-hidden="true"></span>' : '')
      + avatarHTML(c, { size: big ? 56 : 42, order: d.prefs.order })
      + `<span class="ct-row-t"><span class="ct-row-name"><bdi>${nm}</bdi></span>${sub ? `<span class="ct-row-sub">${sub}</span>` : ''}</span></div>`;
  }
  /** The name with the searched words marked, as One UI highlights them. */
  function marked(name, q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const low = name.toLowerCase();
    const hits = [];
    for (const w of words) {
      const i = low.indexOf(w);
      if (i >= 0) hits.push([i, i + w.length]);
    }
    if (!hits.length) return escapeHtml(name);
    hits.sort((a, b) => a[0] - b[0]);
    let out = '', at = 0;
    for (const [a, b] of hits) {
      if (a < at) continue;
      out += escapeHtml(name.slice(at, a)) + `<mark>${escapeHtml(name.slice(a, b))}</mark>`;
      at = b;
    }
    return out + escapeHtml(name.slice(at));
  }

  function drawList() {
    const d = data(), p = d.prefs;
    const me = d.me && M.byId(d, d.me);
    const others = d.items.filter((c) => c.id !== d.me);
    heroSub.textContent = countText(others.length);
    let html = '';
    order = [];
    letters = [];
    if (query) {
      const res = d.items.map((c) => ({ c, ...M.match(c, query, p.order) })).filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || M.displayName(a.c, p.order).localeCompare(M.displayName(b.c, p.order), locale()));
      const names = res.filter((x) => !x.field), other = res.filter((x) => x.field);
      if (names.length) html += `<div class="ct-sec"><div class="ct-sh">${escapeHtml(t('contacts.found', { n: res.length }))}</div><div class="ct-card">${names.map((x) => rowHTML(x.c, { name: marked(contactName(x.c, p.order), query) })).join('')}</div></div>`;
      if (other.length) html += `<div class="ct-sec"><div class="ct-sh">${escapeHtml(names.length ? t('contacts.otherMatches') : t('contacts.found', { n: res.length }))}</div><div class="ct-card">${other.map((x) => rowHTML(x.c, { sub: `<bdi>${escapeHtml(x.field === 'note' ? x.value.split('\n')[0] : x.value)}</bdi>` })).join('')}</div></div>`;
      if (!res.length) html += `<div class="ou-empty ct-empty">${icon('search', 56)}<span>${escapeHtml(t('contacts.noResults'))}</span></div>`;
      order = res.map((x) => x.c.id);
    } else {
      html += `<div class="ct-card ct-profile">${me ? rowHTML(me, { big: true, sub: escapeHtml(t('contacts.myProfile')) })
        : `<button class="ct-row big ct-setup" data-act="profile">${avatarHTML(null, { size: 56 })}<span class="ct-row-t"><span class="ct-row-name">${escapeHtml(t('contacts.setupProfile'))}</span></span></button>`}</div>`;
      if (!others.length) {
        html += `<div class="ou-empty ct-empty">${icon('ctPerson', 56)}<b>${escapeHtml(t('contacts.emptyTitle'))}</b><span>${escapeHtml(t('contacts.emptySub'))}</span>
          <div class="ct-empty-btns"><button class="ou-btn tonal" data-act="new">${escapeHtml(t('contacts.create'))}</button><button class="ou-btn tonal" data-act="import">${escapeHtml(t('contacts.import'))}</button></div></div>`;
      } else {
        const favs = d.favs.filter((id) => id !== d.me).map((id) => M.byId(d, id)).filter(Boolean);
        if (favs.length) html += `<div class="ct-sec ct-favs"><div class="ct-sh">${escapeHtml(t('contacts.favs'))}</div><div class="ct-card">${favs.map((c) => rowHTML(c)).join('')}</div></div>`;
        for (const s of O.sections(others, { sort: p.sort, lang: lang(), locale: locale() })) {
          html += `<div class="ct-sec" data-sec="${escapeHtml(s.key)}"><div class="ct-sh">${escapeHtml(s.key)}</div><div class="ct-card">${s.items.map((c) => rowHTML(c)).join('')}</div></div>`;
          letters.push(s.key);
          order.push(...s.items.map((c) => c.id));
        }
        html += `<div class="ct-count">${escapeHtml(countText(others.length))}</div>`;
      }
      if (me) order.unshift(me.id);
    }
    listEl.innerHTML = html;
    hydrate(listEl);
    drawIndex();
    if (picked) drawSelbar();
  }
  function markActive() {
    listEl.querySelectorAll('.ct-row.on').forEach((n) => n.classList.remove('on'));
    if (!isWide() || picked) return;
    const rows = listEl.querySelectorAll(`.ct-row[data-id="${CSS.escape(sel || '')}"]`);
    rows.forEach((n) => n.classList.add('on'));
    // a favourite appears twice; scroll to its place in the A–Z list
    const target = rows[rows.length - 1];
    if (target) {
      const r = target.getBoundingClientRect(), s = scroller.getBoundingClientRect();
      if (r.top < s.top + 60 || r.bottom > s.bottom) target.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---------------------------------------------------------------- the fast-scroll letter index
  function drawIndex() {
    const show = !query && letters.length > 0;
    listPane.classList.toggle('with-index', show);
    if (!show) {
      index.replaceChildren();
      idxAll = [];
      return;
    }
    const base = O.indexLetters(lang());
    idxAll = [...base.slice(0, -1), ...letters.filter((l) => !base.includes(l)), '#'];
    layoutIndex();
  }
  function layoutIndex() {
    if (!idxAll.length) return;
    // a short window shows every other letter with dots between, so the index always fits
    const max = Math.max(5, Math.floor((index.clientHeight - 8) / 15));
    let shown = idxAll;
    if (idxAll.length > max) {
      const keep = Math.max(3, Math.ceil(max / 2)), step = (idxAll.length - 1) / (keep - 1);
      shown = [];
      for (let i = 0; i < keep; i++) {
        if (i) shown.push('•');
        shown.push(idxAll[Math.round(i * step)]);
      }
    }
    index.innerHTML = shown.map((l) => (l === '•' ? '<i aria-hidden="true">•</i>' : `<button data-l="${escapeHtml(l)}" class="${letters.includes(l) ? 'has' : ''}" tabindex="-1" aria-label="${escapeHtml(l)}">${escapeHtml(l)}</button>`)).join('');
  }
  function jump(l) {
    const i = idxAll.indexOf(l);
    // a letter without contacts goes to the next one that has some
    const target = idxAll.slice(i).find((x) => letters.includes(x)) || [...letters].reverse().find((x) => idxAll.indexOf(x) < i);
    const sec = target && listEl.querySelector(`.ct-sec[data-sec="${CSS.escape(target)}"]`);
    if (sec) scroller.scrollTop = sec.offsetTop - 4;
    return l;
  }
  let scrubbing = false;
  const scrubAt = (y) => {
    const r = index.getBoundingClientRect();
    const k = Math.max(0, Math.min(0.999, (y - r.top - 4) / Math.max(1, r.height - 8)));
    const l = jump(idxAll[Math.floor(k * idxAll.length)]);
    showBubble(l, y - listPane.getBoundingClientRect().top);
  };
  function showBubble(l, y) {
    bubble.textContent = l;
    bubble.style.top = Math.max(70, Math.min(listPane.clientHeight - 50, y)) + 'px';
    bubble.classList.add('show');
  }
  index.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    index.setPointerCapture(e.pointerId);
    index.classList.add('scrub');
    scrubAt(e.clientY);
    e.preventDefault();
  });
  index.addEventListener('pointermove', (e) => scrubbing && scrubAt(e.clientY));
  const endScrub = () => {
    scrubbing = false;
    index.classList.remove('scrub');
    setTimeout(() => !scrubbing && bubble.classList.remove('show'), 450);
  };
  index.addEventListener('pointerup', endScrub);
  index.addEventListener('pointercancel', endScrub);

  // ---------------------------------------------------------------- the detail pane
  function drawPane() {
    if (!isWide() || pane?.kind === 'edit') return;
    const d = data();
    if (sel && !M.byId(d, sel)) sel = null;
    if (!sel) {
      detailPane.replaceChildren(h('div', { class: 'ou-empty ct-pane-empty' }, h('span', { html: icon('ctPerson', 64) }), d.items.length ? t('contacts.selectContact') : t('contacts.emptyTitle')));
      return;
    }
    drawDetail(detailPane, sel, app);
  }
  function refresh() {
    drawList();
    markActive();
    drawPane();
  }

  // ---------------------------------------------------------------- search
  function startSearch() {
    if (picked) stopSelect();
    listPane.classList.add('searching');
    input.focus();
    input.select();
  }
  function stopSearch() {
    listPane.classList.remove('searching');
    input.value = '';
    if (query) {
      query = '';
      drawList();
      markActive();
    }
  }
  input.addEventListener('input', () => {
    query = input.value.trim();
    drawList();
    scroller.scrollTop = 0;
    if (query && isWide() && order[0] && pane?.kind !== 'edit') {
      sel = order[0];
      markActive();
      drawPane();
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && order[0]) {
      e.preventDefault();
      app.openContact(isWide() && order.includes(sel) ? sel : order[0]);
    }
  });

  // ---------------------------------------------------------------- selection mode (long-press, right-click › Select)
  function startSelect(id) {
    if (listPane.classList.contains('searching') && !query) stopSearch();
    picked = new Set(id ? [id] : []);
    listPane.classList.add('selecting');
    drawList();
  }
  function stopSelect() {
    picked = null;
    listPane.classList.remove('selecting');
    drawList();
    markActive();
  }
  function selectable() {
    return query ? order : data().items.map((c) => c.id);
  }
  function drawSelbar() {
    const all = selectable();
    selCount.textContent = picked.size ? t('contacts.selected', { n: picked.size }) : t('contacts.selectItems');
    allBox.checked = all.length > 0 && all.every((id) => picked.has(id));
    selActs.classList.toggle('off', !picked.size);
  }
  allBox.addEventListener('change', () => {
    picked = new Set(allBox.checked ? selectable() : []);
    drawList();
  });
  function toggle(id) {
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    listEl.querySelectorAll(`.ct-row[data-id="${CSS.escape(id)}"]`).forEach((n) => n.classList.toggle('picked', picked.has(id)));
    drawSelbar();
  }

  // ---------------------------------------------------------------- the navigation drawer
  let drawer = null;
  function openDrawer() {
    const d = data();
    const item = (ic, label, count, onClick, cls = '') => h('button', { class: ['ct-dw-item', cls], onClick: () => { closeDrawer(); onClick(); } },
      h('span', { class: 'ct-dw-ico', html: icon(ic, 22) }), h('span', { class: 'ct-dw-label' }, label), count != null ? h('span', { class: 'ct-dw-count' }, String(count)) : null);
    const panel = h('div', { class: 'ct-dw', role: 'dialog', 'aria-label': t('contacts.menu') },
      h('div', { class: 'ct-dw-top' }, iconBtn('settings', () => { closeDrawer(); openSettings(app); }, t('contacts.settings'))),
      item('ctPerson', t('contacts.all'), d.items.filter((c) => c.id !== d.me).length, () => {}, 'on'),
      h('div', { class: 'ct-dw-h' }, t('contacts.groups')),
      ...d.groups.map((g) => item('ctGroup', g.name || t('contacts.untitledGroup'), g.ids.length, () => openGroup(app, g.id))),
      item('plus', t('contacts.createGroup'), null, () => createGroup(app), 'accent'),
      h('div', { class: 'ct-dw-div' }),
      item('ctMerge', t('contacts.manage'), null, () => openManage(app)),
      item('ctBin', t('contacts.bin'), d.trash.length || null, () => openBin(app)));
    const scrim = h('div', { class: 'ct-dw-scrim', onPointerdown: () => closeDrawer() });
    drawer = h('div', { class: 'ct-dw-wrap' }, scrim, panel);
    root.appendChild(drawer);
    requestAnimationFrame(() => drawer?.classList.add('show'));
    panel.querySelector('.ct-dw-item')?.focus({ preventScroll: true });
  }
  function closeDrawer() {
    const dw = drawer;
    drawer = null;
    if (!dw) return;
    dw.classList.remove('show');
    setTimeout(() => dw.remove(), 260);
  }

  // ---------------------------------------------------------------- list events
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) {
      if (b.dataset.act === 'profile') app.editContact(null, { me: true });
      else if (b.dataset.act === 'new') app.editContact(null);
      else if (b.dataset.act === 'import') fileIn.click();
      return;
    }
    const row = e.target.closest('.ct-row[data-id]');
    if (!row) return;
    if (picked) toggle(row.dataset.id);
    else app.openContact(row.dataset.id);
  });
  listEl.addEventListener('keydown', (e) => {
    const row = e.target.closest('.ct-row[data-id]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      row.click();
    }
  });
  listEl.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.ct-row[data-id]');
    if (!row) return;
    e.preventDefault();
    if (picked) return toggle(row.dataset.id);
    const id = row.dataset.id, d = data(), fav = d.favs.includes(id);
    menu(e, [
      { label: t('contacts.select'), icon: 'checkCircle', onClick: () => startSelect(id) },
      { label: t('contacts.edit'), icon: 'edit', onClick: () => app.editContact(id) },
      { label: fav ? t('contacts.removeFav') : t('contacts.addFav'), icon: fav ? 'starFill' : 'star', onClick: () => mutate((x) => { x.favs = fav ? x.favs.filter((y) => y !== id) : [...x.favs, id]; }) },
      { label: t('contacts.share'), icon: 'share', onClick: () => shareContacts([id]) },
      '-',
      { label: t('contacts.delete'), icon: 'trash', danger: true, onClick: () => app.deleteContacts([id]) },
    ]);
  });
  // a long press starts selecting, as on the phone
  const offLong = onLongPress(listEl, (e) => {
    const row = e.target.closest?.('.ct-row[data-id]');
    if (row && !picked) startSelect(row.dataset.id);
  });

  fileIn.addEventListener('change', async () => {
    const files = [...fileIn.files];
    fileIn.value = '';
    const ids = await importFiles(files);
    if (ids?.length) {
      sel = ids[0];
      refresh();
      if (!isWide()) scroller.scrollTop = 0;
    }
  });

  // ---------------------------------------------------------------- keyboard
  const onKey = (e) => {
    if (currentApp() !== 'contacts' || !root.isConnected) return;
    if (document.querySelector('.ou-dialog-scrim, .ou-menu-scrim')) return;
    const inField = !!e.target.closest?.('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape') {
      const done = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (drawer) return done(), closeDrawer();
      if (ctx.depth > 1) return; // the shell pops pushed pages (the editor page asks itself)
      if (picked) return done(), stopSelect();
      if (listPane.classList.contains('searching')) return done(), stopSearch();
      if (pane?.kind === 'edit') return done(), pane.editor.cancel();
      return;
    }
    if (ctx.depth > 1 || pane?.kind === 'edit') return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
      e.preventDefault();
      startSearch();
      return;
    }
    if (inField || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      startSearch();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && isWide() && order.length && !picked) {
      e.preventDefault();
      const i = order.indexOf(sel);
      app.openContact(order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)))]);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && isWide() && sel && !picked) {
      e.preventDefault();
      app.deleteContacts([sel]);
    }
  };
  addEventListener('keydown', onKey, true);

  // ---------------------------------------------------------------- layout: two panes when the window is wide
  const ro = new ResizeObserver(() => {
    const wide = root.clientWidth >= 720;
    if (wide !== isWide()) {
      root.classList.toggle('wide', wide);
      if (wide) {
        if (!sel) sel = firstId();
        refresh();
      }
    }
    layoutIndex();
  });
  ro.observe(root);
  function firstId() {
    const d = data();
    const others = d.items.filter((c) => c.id !== d.me);
    return O.sections(others, { sort: d.prefs.sort, lang: lang(), locale: locale() })[0]?.items[0]?.id || d.me || null;
  }

  // ---------------------------------------------------------------- live updates, opening a contact from outside
  const off = store.on(M.KEY, () => {
    drawList();
    markActive();
    drawPane();
  });
  function apply(p = {}) {
    const id = p.id || p.section;
    if (id && M.byId(data(), id)) app.openContact(id);
    else if (p.new) app.editContact(null);
  }
  ctx.setParams = (p) => apply(p);

  root.classList.toggle('wide', root.clientWidth >= 720 || (!root.clientWidth && innerWidth >= 760));
  sel = firstId();
  refresh();
  apply(ctx.params);

  // Recycle bin entries older than 30 days are dropped when the data is read; save that, and remove photos no
  // contact (or Recycle bin entry) uses any more.
  const raw = store.get(M.KEY);
  if (raw && Array.isArray(raw.trash) && raw.trash.length !== data().trash.length) mutate(() => {});
  const gc = setTimeout(async () => {
    try {
      const d = data();
      const used = new Set([...d.items.map((c) => c.photo), ...d.trash.map((x) => x.c.photo)].filter(Boolean));
      for (const k of await listBlobs('contacts:')) if (!used.has(k)) await delBlob(k);
    } catch (e) {
      console.warn('contacts photos', e);
    }
  }, 4000);

  return () => {
    off();
    offLong();
    ro.disconnect();
    clearTimeout(gc);
    removeEventListener('keydown', onKey, true);
    pane?.editor?.dispose();
  };
}

addStrings({
  en: {
    'contacts.myProfile': 'My profile',
    'contacts.setupProfile': 'Set up profile',
    'contacts.favs': 'Favourites',
    'contacts.create': 'Create contact',
    'contacts.menu': 'Navigation menu',
    'contacts.found': '{n} found',
    'contacts.otherMatches': 'Other matches',
    'contacts.noResults': 'No results found',
    'contacts.emptyTitle': 'No contacts',
    'contacts.emptySub': 'Contacts you create or import will show up here.',
    'contacts.import': 'Import contacts',
    'contacts.export': 'Export contacts',
    'contacts.selectAll': 'All',
    'contacts.selected': '{n} selected',
    'contacts.selectItems': 'Select contacts',
    'contacts.share': 'Share',
    'contacts.addToGroup': 'Add to group',
    'contacts.delete': 'Delete',
    'contacts.select': 'Select',
    'contacts.edit': 'Edit',
    'contacts.addFav': 'Add to Favourites',
    'contacts.removeFav': 'Remove from Favourites',
    'contacts.deleteQ1': 'Move this contact to the Recycle bin?',
    'contacts.deleteQn': 'Move {n} contacts to the Recycle bin?',
    'contacts.moveToBin': 'Move to Recycle bin',
    'contacts.binned1': 'Contact moved to the Recycle bin',
    'contacts.binnedN': '{n} contacts moved to the Recycle bin',
    'contacts.selectContact': 'Select a contact to see the details here',
    'contacts.all': 'All contacts',
    'contacts.groups': 'Groups',
    'contacts.untitledGroup': 'Untitled group',
    'contacts.createGroup': 'Create group',
    'contacts.manage': 'Manage contacts',
    'contacts.bin': 'Recycle bin',
    'contacts.settings': 'Contacts settings',
    'contacts.saved': 'Contact saved',
    'contacts.index': 'Index',
  },
  ar: {
    'contacts.myProfile': 'ملفي الشخصي',
    'contacts.setupProfile': 'إعداد الملف الشخصي',
    'contacts.favs': 'المفضلة',
    'contacts.create': 'إنشاء جهة اتصال',
    'contacts.menu': 'قائمة التنقل',
    'contacts.found': 'تم العثور على {n}',
    'contacts.otherMatches': 'تطابقات أخرى',
    'contacts.noResults': 'لم يتم العثور على نتائج',
    'contacts.emptyTitle': 'لا توجد جهات اتصال',
    'contacts.emptySub': 'ستظهر هنا جهات الاتصال التي تنشئها أو تستوردها.',
    'contacts.import': 'استيراد جهات الاتصال',
    'contacts.export': 'تصدير جهات الاتصال',
    'contacts.selectAll': 'الكل',
    'contacts.selected': 'تم تحديد {n}',
    'contacts.selectItems': 'تحديد جهات الاتصال',
    'contacts.share': 'مشاركة',
    'contacts.addToGroup': 'إضافة إلى مجموعة',
    'contacts.delete': 'حذف',
    'contacts.select': 'تحديد',
    'contacts.edit': 'تعديل',
    'contacts.addFav': 'إضافة إلى المفضلة',
    'contacts.removeFav': 'إزالة من المفضلة',
    'contacts.deleteQ1': 'هل تريد نقل جهة الاتصال هذه إلى سلة المحذوفات؟',
    'contacts.deleteQn': 'هل تريد نقل {n} جهة اتصال إلى سلة المحذوفات؟',
    'contacts.moveToBin': 'نقل إلى سلة المحذوفات',
    'contacts.binned1': 'تم نقل جهة الاتصال إلى سلة المحذوفات',
    'contacts.binnedN': 'تم نقل {n} جهة اتصال إلى سلة المحذوفات',
    'contacts.selectContact': 'اختر جهة اتصال لعرض تفاصيلها هنا',
    'contacts.all': 'كل جهات الاتصال',
    'contacts.groups': 'المجموعات',
    'contacts.untitledGroup': 'مجموعة بلا اسم',
    'contacts.createGroup': 'إنشاء مجموعة',
    'contacts.manage': 'إدارة جهات الاتصال',
    'contacts.bin': 'سلة المحذوفات',
    'contacts.settings': 'إعدادات جهات الاتصال',
    'contacts.saved': 'تم حفظ جهة الاتصال',
    'contacts.index': 'الفهرس',
  },
});
