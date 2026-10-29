// Voice Recorder screens pushed from the recording screen: the recordings list (category picker, search, sort,
// selection mode with a bottom bar, long-press and right-click menus), the Recycle bin, Categories and Settings.
import { h, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { store } from '../core/store.js';
import { toast, menu, dialog, prompt, choose, iconBtn, list as ouList, row, switchRow, subheader } from '../core/ui.js';
import * as M from './model.js';
import { D, prefs, setPrefs, destroy, restore, addCat, renameCat, deleteCat, catName } from './data.js';
import * as E from './engine.js';
import { MODE_ICON, dateText, daysText, renameRec, shareRec, saveFile, canShare, changeCategory, trashRecs, details, STT_LANGS, langName, detectStt } from './common.js';

// ------------------------------------------------------------------ recordings list
export function listPage(env, hl) {
  const { ctx } = env;
  let query = '', searching = false, selecting = false, shown = [], tick = 0;
  const sel = new Set();
  // the toolbar buttons exist before the page renders; they call into it through `api`
  const api = {};
  const searchBtn = iconBtn('search', () => api.setSearch(true), t('common.search'));
  const moreBtn = iconBtn('more', (e) => api.moreMenu(e.currentTarget), t('common.more'));
  const cancelSel = h('button', { class: 'rec-tb-text', onClick: () => api.setSelect(false) }, t('common.cancel'));
  let page;
  page = ctx.push({
    title: t('recorder.list'),
    hero: false,
    className: 'rec-page rec-list-page',
    actions: [searchBtn, moreBtn],
    render(body, pg) {
      page = pg;
      body.classList.add('flush');
      const catBtn = h('button', { class: 'rec-catbtn', onClick: () => catMenu(catBtn) }, h('span', { class: 'rec-catbtn-t' }), h('span', { html: icon('down', 18) }));
      const count = h('span', { class: 'rec-count' });
      const input = h('input', { type: 'search', placeholder: t('recorder.searchPh'), 'aria-label': t('common.search'), spellcheck: 'false' });
      const searchBox = h('label', { class: 'ou-searchbox rec-search', hidden: true }, h('span', { html: icon('search', 20) }), input);
      const allChk = h('button', { class: 'rec-allchk', onClick: () => toggleAll() }, h('span', { class: 'rec-chk', html: icon('check', 14) }), h('span', null, t('recorder.all')));
      const selHead = h('div', { class: 'rec-selhead', hidden: true }, allChk);
      const rows = h('div', { class: 'rec-rows' });
      const selBar = h('div', { class: 'rec-selbar', hidden: true });
      body.appendChild(h('div', { class: 'rec-list' }, h('div', { class: 'rec-lhead' }, catBtn, count), searchBox, selHead, rows));
      page.el.appendChild(selBar);

      input.addEventListener('input', () => {
        query = input.value.trim();
        draw();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && input.value) {
          e.preventDefault();
          e.stopPropagation();
          input.value = '';
          query = '';
          draw();
        }
      });
      page.el.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        if (selecting) setSelect(false);
        else if (searching) setSearch(false);
        else return;
        e.preventDefault();
      });

      env._list = { draw: () => draw() };
      function draw() {
        const d = D(), p = prefs();
        let cat = p.cat;
        if (cat !== 'all' && cat !== 'none' && !d.cats.some((c) => c.id === cat)) cat = 'all';
        catBtn.firstChild.textContent = cat === 'all' ? t('recorder.allRec') : cat === 'none' ? t('recorder.cat.none') : catName(cat);
        shown = M.sortItems(d.items.filter((m) => M.inCat(m, cat) && M.matches(m, query)), p.sort);
        for (const id of [...sel]) if (!shown.some((m) => m.id === id)) sel.delete(id);
        count.textContent = shown.length ? t('recorder.nRec', { n: shown.length }) : '';
        if (!shown.length) {
          rows.className = 'rec-rows';
          rows.replaceChildren(h('div', { class: 'ou-empty rec-empty' }, h('span', { html: icon(query ? 'search' : 'rec-wave', 56) }), query ? t('recorder.noResults') : t('recorder.empty'), query ? null : h('small', null, t('recorder.emptyHint'))));
        } else {
          rows.className = 'rec-rows ou-card';
          rows.replaceChildren(...shown.map((m) => rowEl(m, cat)));
        }
        searchBox.hidden = !searching;
        selHead.hidden = !selecting;
        allChk.classList.toggle('on', selecting && shown.length > 0 && sel.size === shown.length);
        page.setTitle(selecting ? (sel.size ? t('recorder.nSelected', { n: sel.size }) : t('recorder.select')) : t('recorder.list'));
        page.setActions(selecting ? [cancelSel] : [searchBtn, moreBtn]);
        drawSelBar();
        clearInterval(tick);
        if (E.active() && shown.some((m) => m.id === E.active().id)) tick = setInterval(liveTime, 500);
      }
      function liveTime() {
        const a = E.active(), el = a && rows.querySelector(`.rec-row[data-id="${CSS.escape(a.id)}"] .rec-row-len`);
        if (el) el.textContent = M.fmtLen(E.elapsed());
      }
      function rowEl(m, cat) {
        const live = E.active()?.id === m.id;
        const marks = M.visibleMarks(m).length;
        const el = h('div', {
          class: ['rec-row', sel.has(m.id) && 'sel', hl === m.id && 'hl', live && 'live'],
          role: 'button',
          tabindex: 0,
          dataset: { id: m.id },
          onClick: () => open(m),
          onKeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              open(m);
            }
          },
          onContextmenu: (e) => {
            e.preventDefault();
            if (!m.rec) itemMenu(e, m);
          },
        },
          selecting ? h('span', { class: 'rec-chk', html: icon('check', 14) }) : h('span', { class: ['rec-row-ico', 'm-' + m.mode], html: icon(MODE_ICON[m.mode], 20) }),
          h('span', { class: 'rec-row-text' },
            h('span', { class: 'rec-row-title', dir: 'auto' }, m.title),
            h('span', { class: 'rec-row-sub' },
              h('span', null, live ? (E.active().paused ? t('recorder.paused') : t('recorder.recordingNow')) : m.rec ? t('recorder.saving') : dateText(m.at)),
              m.cat && cat === 'all' ? h('span', { class: 'rec-row-cat' }, catName(m.cat)) : null)),
          h('span', { class: 'rec-row-end' },
            h('span', { class: 'rec-row-len', dir: 'ltr' }, live ? M.fmtLen(E.elapsed()) : M.fmtLen(M.editLen(m))),
            marks || m.text ? h('span', { class: 'rec-row-badges' },
              marks ? h('span', { class: 'rec-badge', title: t('recorder.bookmarks') }, h('span', { html: icon('rec-flag', 13) }), String(marks)) : null,
              m.text ? h('span', { class: 'rec-badge', title: t('recorder.mode.stt'), html: icon('rec-stt', 13) }) : null) : null));
        onLongPress(el, () => {
          if (m.rec) return;
          if (!selecting) setSelect(true);
          sel.add(m.id);
          draw();
        });
        return el;
      }
      function open(m) {
        if (selecting) {
          if (m.rec) return;
          if (sel.has(m.id)) sel.delete(m.id);
          else sel.add(m.id);
          draw();
          return;
        }
        if (m.rec) {
          // the recording in progress lives on the recording screen
          if (E.active()?.id === m.id) while (ctx.depth > 1) ctx.pop();
          return;
        }
        env.openPlay(m.id);
      }
      function toggleAll() {
        const all = shown.filter((m) => !m.rec);
        if (sel.size === all.length) sel.clear();
        else all.forEach((m) => sel.add(m.id));
        draw();
      }
      function setSelect(on) {
        selecting = on;
        sel.clear();
        if (on) setSearch(false, true);
        draw();
      }
      function setSearch(on, quiet) {
        searching = on;
        if (!on) {
          input.value = '';
          query = '';
        }
        if (!quiet) draw();
        if (on) setTimeout(() => input.focus(), 30);
      }
      function drawSelBar() {
        selBar.hidden = !selecting;
        if (!selecting) return;
        const ids = [...sel], n = ids.length, one = n === 1 ? D().items.find((m) => m.id === ids[0]) : null;
        const b = (ic, label, fn, on = n > 0) => h('button', { class: 'rec-selbtn', disabled: !on, onClick: fn }, h('span', { html: icon(ic, 22) }), h('span', null, label));
        selBar.replaceChildren(
          b('download', t('recorder.saveFile'), async () => {
            for (const id of ids) await saveFile(D().items.find((m) => m.id === id));
          }),
          b('edit', t('common.rename'), async () => {
            if (await renameRec(one)) setSelect(false);
          }, !!one),
          b('rec-tag', t('recorder.category'), async () => {
            if (await changeCategory(ids)) setSelect(false);
          }),
          b('trash', t('common.delete'), async () => {
            if (await trashRecs(ids, { ask: true })) setSelect(false);
          }));
      }
      function moreMenu(at) {
        menu(at, [
          { label: t('recorder.select'), icon: 'checkCircle', disabled: !shown.some((m) => !m.rec), onClick: () => setSelect(true) },
          { label: t('recorder.sortBy'), icon: 'sort', onClick: () => sortDialog() },
          { label: t('recorder.cats'), icon: 'rec-tag', onClick: () => env.openCats() },
          '-',
          { label: t('recorder.bin'), icon: 'trash', onClick: () => env.openBin() },
          { label: t('common.settings'), icon: 'settings', onClick: () => env.openSettings() },
        ], { align: 'end' });
      }
      function catMenu(at) {
        const d = D(), cur = prefs().cat, pick = (c) => setPrefs({ cat: c });
        menu(at, [
          { label: t('recorder.allRec'), checked: cur === 'all', onClick: () => pick('all') },
          ...d.cats.map((c) => ({ label: c.name, checked: cur === c.id, onClick: () => pick(c.id) })),
          d.cats.length ? { label: t('recorder.cat.none'), checked: cur === 'none', onClick: () => pick('none') } : null,
          '-',
          { label: t('recorder.cats'), icon: 'rec-tag', onClick: () => env.openCats() },
        ]);
      }
      async function sortDialog() {
        const v = await choose(t('recorder.sortBy'), M.SORTS.map((s) => ({ value: s, label: t('recorder.sort.' + s) })), prefs().sort);
        if (v) setPrefs({ sort: v });
      }

      Object.assign(api, { setSearch, setSelect, moreMenu });
      const off1 = store.on(M.KEY, draw), off2 = store.on(M.PREFS, draw), off3 = E.onChange(() => draw());
      if (hl) setTimeout(() => (hl = null), 2500);
      draw();
      return () => {
        clearInterval(tick);
        off1();
        off2();
        off3();
        if (env._list?.draw === draw) env._list = null;
      };
    },
  });
  // Ctrl/⌘+F searches the list
  page.el.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchBtn.click();
    }
  });
  return page;
}

/** The menu of one recording (right-click in the list). */
export function itemMenu(at, m) {
  menu(at, [
    { label: t('common.rename'), icon: 'edit', onClick: () => renameRec(m) },
    canShare() ? { label: t('recorder.share'), icon: 'share', onClick: () => shareRec(m) } : null,
    { label: t('recorder.saveFile'), icon: 'download', onClick: () => saveFile(m) },
    { label: t('recorder.changeCat'), icon: 'rec-tag', onClick: () => changeCategory([m.id]) },
    { label: t('recorder.details'), icon: 'info', onClick: () => details(m) },
    '-',
    { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => trashRecs([m.id]) },
  ]);
}

// ------------------------------------------------------------------ Recycle bin
export function binPage(env) {
  const { ctx } = env;
  const moreBtn = iconBtn('more', (e) => {
    const n = D().items.filter((m) => m.deletedAt).length;
    menu(e.currentTarget, [
      { label: t('recorder.restoreAll'), icon: 'rec-restore', disabled: !n, onClick: () => restore(D().items.filter((m) => m.deletedAt).map((m) => m.id)) },
      { label: t('recorder.empty.bin'), icon: 'trash', danger: true, disabled: !n, onClick: () => forever(D().items.filter((m) => m.deletedAt).map((m) => m.id), true) },
    ], { align: 'end' });
  }, t('common.more'));
  async function forever(ids, all = false) {
    if (!ids.length) return;
    const ok = await dialog({
      title: all ? t('recorder.emptyQ') : ids.length === 1 ? t('recorder.deleteForeverOne') : t('recorder.deleteForeverN', { n: ids.length }),
      message: t('recorder.cantUndo'),
      actions: [{ label: t('common.cancel'), value: false }, { label: all ? t('recorder.empty.bin') : t('common.delete'), value: true, danger: true }],
    });
    if (ok) await destroy(ids);
  }
  return ctx.push({
    title: t('recorder.bin'),
    hero: false,
    className: 'rec-page rec-bin-page',
    actions: [moreBtn],
    render(body) {
      body.classList.add('flush');
      const wrap = h('div', { class: 'rec-list' });
      body.appendChild(wrap);
      const draw = () => {
        const items = D().items.filter((m) => m.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
        const note = h('div', { class: 'rec-binnote' }, prefs().bin ? t('recorder.binNote') : t('recorder.binOffNote'));
        if (!items.length) {
          wrap.replaceChildren(note, h('div', { class: 'ou-empty rec-empty' }, h('span', { html: icon('trash', 56) }), t('recorder.binEmpty')));
          return;
        }
        wrap.replaceChildren(note, h('div', { class: 'rec-rows ou-card' },
          items.map((m) =>
            h('div', {
              class: 'rec-row',
              role: 'button',
              tabindex: 0,
              dataset: { id: m.id },
              onClick: (e) => menu(e, [
                { label: t('recorder.restore'), icon: 'rec-restore', onClick: () => { restore([m.id]); toast(t('recorder.restored')); } },
                { label: t('recorder.deleteForever'), icon: 'trash', danger: true, onClick: () => forever([m.id]) },
              ]),
              onKeydown: (e) => e.key === 'Enter' && e.currentTarget.click(),
            },
              h('span', { class: ['rec-row-ico', 'm-' + m.mode], html: icon(MODE_ICON[m.mode], 20) }),
              h('span', { class: 'rec-row-text' }, h('span', { class: 'rec-row-title', dir: 'auto' }, m.title), h('span', { class: 'rec-row-sub rec-days' }, daysText(M.daysLeft(m)))),
              h('span', { class: 'rec-row-end' }, h('span', { class: 'rec-row-len', dir: 'ltr' }, M.fmtLen(M.editLen(m))))))));
      };
      draw();
      const off = store.on(M.KEY, draw);
      return off;
    },
  });
}

// ------------------------------------------------------------------ Categories
export function catsPage(env) {
  const { ctx } = env;
  const add = async () => {
    const name = (await prompt(t('recorder.cat.add'), { placeholder: t('recorder.cat.name'), okLabel: t('common.add') }))?.trim();
    if (name) addCat(name);
  };
  return ctx.push({
    title: t('recorder.cats'),
    hero: false,
    className: 'rec-page rec-cats-page',
    actions: [iconBtn('plus', add, t('recorder.cat.add'))],
    render(body) {
      const draw = () => {
        const d = D();
        const n = (id) => d.items.filter((m) => !m.deletedAt && m.cat === id).length;
        if (!d.cats.length) {
          body.replaceChildren(h('div', { class: 'ou-empty rec-empty' }, h('span', { html: icon('rec-tag', 56) }), t('recorder.cat.empty'), h('small', null, t('recorder.cat.emptyHint')), h('button', { class: 'ou-btn primary', onClick: add }, t('recorder.cat.add'))));
          return;
        }
        body.replaceChildren(ouList(...d.cats.map((c) => {
          // a div row (not the kit's button row) because it holds its own ⋮ button
          const r = row({
            icon: 'rec-tag',
            title: c.name,
            sub: t('recorder.nRec', { n: n(c.id) }),
            className: 'muted-sub rec-cat-row clickable',
            right: iconBtn('more', (e) => {
              e.stopPropagation();
              menu(e.currentTarget, [
                { label: t('common.rename'), icon: 'edit', onClick: async () => { const v = (await prompt(t('recorder.cat.rename'), { value: c.name }))?.trim(); if (v) renameCat(c.id, v); } },
                { label: t('common.delete'), icon: 'trash', danger: true, onClick: async () => {
                  const ok = await dialog({ title: t('recorder.cat.deleteQ', { name: c.name }), message: t('recorder.cat.deleteMsg'), actions: [{ label: t('common.cancel'), value: false }, { label: t('common.delete'), value: true, danger: true }] });
                  if (ok) {
                    deleteCat(c.id);
                    if (prefs().cat === c.id) setPrefs({ cat: 'all' });
                  }
                } },
              ], { align: 'end' });
            }, t('common.more')),
          });
          r.tabIndex = 0;
          r.setAttribute('role', 'button');
          r.addEventListener('click', () => {
            setPrefs({ cat: c.id });
            ctx.pop();
          });
          return r;
        })));
      };
      draw();
      return store.on(M.KEY, draw);
    },
  });
}

// ------------------------------------------------------------------ Settings
export function settingsPage(env) {
  const { ctx } = env;
  return ctx.push({
    title: t('common.settings'),
    hero: true,
    className: 'rec-page rec-settings-page',
    render(body) {
      const draw = () => {
        const p = prefs();
        const qual = (q) => t('recorder.q.' + q, { k: M.QUALITY[q] / 1000 });
        body.replaceChildren(...[
          subheader(t('recorder.set.recording')),
          ouList(
            row({ title: t('recorder.set.quality'), sub: qual(p.quality), onClick: async () => {
              const v = await choose(t('recorder.set.quality'), Object.keys(M.QUALITY).map((q) => ({ value: q, label: qual(q), sub: t('recorder.q.' + q + 'Sub') })), p.quality);
              if (v) setPrefs({ quality: v });
            } }),
            switchRow({ title: t('recorder.set.askName'), sub: t('recorder.set.askNameSub'), checked: p.askName, onChange: (v) => setPrefs({ askName: v }) })),
          env.stt.ok || E.SR()?.available ? ouList(
            row({ title: t('recorder.set.sttLang'), sub: langName(env.stt.lang), onClick: () => pickLang() })) : null,
          subheader(t('recorder.bin')),
          ouList(switchRow({ title: t('recorder.bin'), sub: t('recorder.set.binSub'), checked: p.bin, onChange: (v) => setPrefs({ bin: v }) })),
          h('p', { class: 'rec-privacy' }, t('recorder.set.privacy')),
        ].filter(Boolean));
        body.querySelectorAll('.ou-row-sub').forEach((s) => s.classList.add('muted'));
      };
      async function pickLang() {
        const states = await Promise.all(STT_LANGS.map((l) => E.sttAvailability(l)));
        const opts = STT_LANGS.map((l, i) => ({ value: l, label: langName(l), sub: states[i] === 'available' ? t('recorder.stt.onDevice') : t('recorder.stt.needsDl'), st: states[i] })).filter((o) => o.st !== 'unavailable');
        if (!opts.length) return toast(t('recorder.stt.none'));
        const v = await choose(t('recorder.set.sttLang'), opts, env.stt.lang);
        if (!v) return;
        setPrefs({ sttLang: v });
        await detectStt(env);
        env.main?.draw();
        draw();
      }
      draw();
      return store.on(M.PREFS, draw);
    },
  });
}
