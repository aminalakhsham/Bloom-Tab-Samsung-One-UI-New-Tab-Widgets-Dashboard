// The reminder detail screen (Samsung Reminder's edit view): title with Important star, Date and time (quick days,
// date and time pickers), Repeat (presets or custom: every n days/weeks/months/years, weekdays, an end date), Early
// alert, Category, Subtasks, Notes (+ Writing assist when the shell has it), a web page link and pictures (IndexedDB
// through core/blobs.js). Everything saves as you go; a new reminder (draft) is added when you leave it with a title.
import { h, debounce, uid, pickFile, readImage, toUrl } from '../core/util.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { t, weekdayNames, fmtDate } from '../core/i18n.js';
import { toast, dialog, choose, iconBtn, switchRow, row, menu, seg } from '../core/ui.js';
import { putBlob, blobUrl, dataUrlToBlob } from '../core/blobs.js';
import * as M from './model.js';
import * as D from './data.js';
import { fmtDue, repeatText, earlyText, catName } from './format.js';
import { checkbox, catBadge } from './kit.js';

/** Picture blobs added in an editor that hasn't saved them yet (the clean-up of unused pictures skips them). */
export const pendingImages = new Set();
const pad = (n) => String(n).padStart(2, '0');
const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const nextHour = () => Math.ceil((Date.now() + 60e3) / 3600e3) * 3600e3;
const MAX_IMGS = 12;

export function openEditor(app, id, { draft } = {}) {
  const isDraft = !id;
  let local = isDraft ? M.make({ ...(draft || {}) }) : null;
  if (!isDraft && !D.find(id)) return;
  const rid = isDraft ? local.id : id;
  const cur = () => (isDraft ? local : D.find(rid) || {});
  let saved = false, gone = false;

  // Field changes made within the debounce window are merged, so e.g. a note typed right after the star both save.
  let pending = {};
  const flush = () => {
    const f = pending;
    pending = {};
    if (!Object.keys(f).length) return;
    if (isDraft) local = M.patchIn([local], rid, f)[0];
    else if (D.find(rid)) D.patch(rid, f);
  };
  const later = debounce(flush, 250);
  const save = (f, now = false) => {
    Object.assign(pending, f);
    now ? flush() : later();
  };

  const actions = isDraft ? [] : [
    iconBtn('trash', () => {
      gone = true;
      app.ctx.pop();
      const undo = D.removeMany([rid]);
      toast(t('rem.deleted'), { action: t('common.undo'), onAction: undo });
    }, t('common.delete')),
    iconBtn('more', (e) => menu(e.currentTarget, [
      { label: t('rem.duplicate'), icon: 'copy', onClick: () => {
        flush();
        // (pictures are shared: unused ones are only cleaned up when no reminder points at them)
        const { id: _id, order: _o, from: _f, snooze: _s, ...rest } = cur();
        const copy = D.addReminder({ ...rest, done: false, completedAt: null, created: Date.now() });
        app.ctx.pop();
        app.openEditor(copy.id);
      } },
      { label: t('rem.copyText'), icon: 'copy', onClick: () => {
        const r = cur();
        navigator.clipboard?.writeText([r.title, r.due ? fmtDue(r.due) : '', r.notes, ...(r.subs || []).map((s) => (s.done ? '☑ ' : '☐ ') + s.title), r.url].filter(Boolean).join('\n')).then(() => toast(t('rem.copied')), () => {});
      } },
    ], { align: 'end' }), t('common.more')),
  ];

  const pageObj = app.ctx.push({
    title: isDraft ? t('rem.new') : t('rem.edit'),
    hero: false,
    className: 'rem-page rem-edit-page',
    actions,
    render(body) {
      body.classList.add('rem-edit');
      const r0 = cur();

      // ——— title, check, star ———
      const title = h('textarea', { class: 'rem-edit-title', rows: 1, placeholder: t('rem.titlePh'), value: r0.title || '', dir: 'auto', maxlength: 500 });
      const fit = (el) => {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
      };
      title.addEventListener('input', () => {
        fit(title);
        save({ title: title.value });
      });
      title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(); // one line, like Samsung Reminder's title
      });
      const star = h('button', { class: ['rem-edit-star', r0.priority && 'on'], 'aria-pressed': String(!!r0.priority), title: t('rem.important'), 'aria-label': t('rem.important'), html: icon(r0.priority ? 'starFill' : 'star', 24) });
      star.addEventListener('click', () => {
        const on = !star.classList.contains('on');
        star.classList.toggle('on', on);
        star.setAttribute('aria-pressed', String(on));
        star.innerHTML = icon(on ? 'starFill' : 'star', 24);
        save({ priority: on }, true);
      });
      const check = isDraft ? null : checkbox(r0, () => {
        flush();
        const r = cur();
        const undo = D.setDone(rid, !r.done);
        const now = D.find(rid);
        toast(!r.done ? (r.repeat && now && !now.done ? t('rem.doneNext', { when: fmtDue(now.due) }) : t('rem.completedToast')) : t('rem.restored'), { action: t('common.undo'), onAction: undo });
        app.ctx.pop();
      });
      const head = h('div', { class: 'ou-card rem-edit-head' }, check, title, star);

      // ——— date and time, repeat, early alert ———
      const base = new Date(r0.due || nextHour());
      const date = h('input', { class: 'ou-input', type: 'date', value: toDateInput(base), 'aria-label': t('rem.date') });
      const time = h('input', { class: 'ou-input', type: 'time', value: toTimeInput(base), 'aria-label': t('rem.time') });
      const quick = h('div', { class: 'ou-chips rem-edit-quick' });
      const pickers = h('div', { class: 'rem-edit-pickers', hidden: !r0.due }, quick, h('div', { class: 'rem-edit-dt' }, date, time));
      const applyDue = () => {
        if (!date.value) return;
        const [y, mo, d] = date.value.split('-').map(Number);
        const [hh, mm] = (time.value || '09:00').split(':').map(Number);
        save({ due: new Date(y, mo - 1, d, hh, mm).getTime() }, true);
        drawWhen();
      };
      date.addEventListener('change', applyDue);
      time.addEventListener('change', applyDue);
      const dueRow = switchRow({
        icon: 'alarm',
        title: t('rem.dateTime'),
        sub: r0.due ? fmtDue(r0.due) : '',
        checked: !!r0.due,
        onChange: (on) => {
          pickers.hidden = !on;
          if (on) applyDue();
          else {
            save({ due: null }, true);
            drawWhen();
          }
        },
      });
      dueRow.classList.add('rem-edit-due');
      const repRow = row({ icon: 'rmRepeat', title: t('rem.repeat'), sub: repeatText(r0.repeat), chevron: true, onClick: () => editRepeat() });
      const earlyRow = row({ icon: 'rmEarly', title: t('rem.earlyAlert'), sub: earlyText(r0.early), chevron: true, onClick: () => editEarly() });
      repRow.classList.add('rem-edit-rep');
      earlyRow.classList.add('rem-edit-early');
      const whenCard = h('div', { class: 'ou-card ou-list rem-edit-when' }, dueRow, h('div', { class: 'rem-edit-pickers-wrap' }, pickers), repRow, earlyRow);
      function drawWhen() {
        const r = { ...cur(), ...pending };
        const sub = dueRow.querySelector('.ou-row-text');
        let s = sub.querySelector('.ou-row-sub');
        if (!s) sub.append((s = h('span', { class: 'ou-row-sub' })));
        s.textContent = r.due ? fmtDue(r.due) : '';
        s.classList.toggle('overdue', M.isOverdue(r));
        repRow.hidden = earlyRow.hidden = !r.due;
        repRow.querySelector('.ou-row-sub').textContent = repeatText(r.repeat);
        earlyRow.querySelector('.ou-row-sub').textContent = earlyText(r.early);
        const today = new Date();
        const days = [[t('common.today'), 0], [t('common.tomorrow'), 1], [t('rem.nextWeek'), 7]];
        quick.replaceChildren(...days.map(([label, n]) => {
          const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
          return h('button', {
            class: ['ou-chip', date.value === toDateInput(d) && 'active'],
            onClick: () => {
              date.value = toDateInput(d);
              applyDue();
            },
          }, label);
        }));
      }
      async function editRepeat() {
        const r = cur();
        const wd = new Date(r.due || Date.now()).getDay();
        const opts = [
          ['none', t('rem.rep.none')], ['daily', t('rem.rep.daily')], ['weekdays', t('rem.rep.weekdays')],
          ['weekly', t('rem.rep.weeklyOn', { day: weekdayNames('long')[wd] })], ['monthly', t('rem.rep.monthlyOn', { n: new Date(r.due || Date.now()).getDate() })],
          ['yearly', t('rem.rep.yearlyOn', { date: fmtDate(new Date(r.due || Date.now()), { month: 'long', day: 'numeric' }) })], ['custom', t('rem.rep.custom')],
        ];
        const curKey = !r.repeat ? 'none' : presetKey(r.repeat) || 'custom';
        const v = await choose(t('rem.repeat'), opts.map(([value, label]) => ({ value, label, sub: value === 'custom' && curKey === 'custom' ? repeatText(r.repeat) : null })), curKey);
        if (v == null) return;
        let rep = null;
        if (v === 'custom') {
          rep = await customRepeat(r.repeat, r.due);
          if (rep === undefined) return;
        } else if (v !== 'none') rep = { daily: { f: 'd' }, weekdays: { f: 'w', days: [1, 2, 3, 4, 5] }, weekly: { f: 'w' }, monthly: { f: 'm' }, yearly: { f: 'y' } }[v];
        save({ repeat: rep }, true);
        drawWhen();
      }
      async function editEarly() {
        const v = await choose(t('rem.earlyAlert'), [0, ...M.EARLY].map((m) => ({ value: m, label: earlyText(m) })), cur().early || 0);
        if (v == null) return;
        save({ early: v || null }, true);
        drawWhen();
      }

      // ——— category ———
      const catRow = row({ icon: 'list', title: t('rem.category'), sub: catName(M.catOf(D.cats(), r0)), chevron: true, onClick: async () => {
        const cs = D.cats();
        const v = await choose(t('rem.category'), cs.list.map((c) => ({ value: c.id, label: catName(c) })), M.catIdOf(cs, cur()));
        if (v == null) return;
        save({ cat: v }, true);
        drawCat();
      } });
      catRow.classList.add('rem-edit-cat');
      function drawCat() {
        const c = M.catOf(D.cats(), { ...cur(), ...pending });
        catRow.querySelector('.ou-row-ico').replaceWith(Object.assign(catBadge(c, 18), { className: 'ou-row-ico rem-badge' }));
        catRow.querySelector('.ou-row-sub').textContent = catName(c);
      }

      // ——— subtasks ———
      let subs = (r0.subs || []).map((s) => ({ ...s }));
      const subList = h('div', { class: 'rem-subs' });
      const saveSubs = (now) => save({ subs: subs.filter((s) => s.title.trim() || s === focusSub).map((s) => ({ ...s })) }, now);
      let focusSub = null;
      const newSub = h('input', { class: 'rem-sub-input', placeholder: t('rem.addSub'), 'aria-label': t('rem.addSub'), dir: 'auto', maxlength: 300 });
      newSub.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = newSub.value.trim();
        if (!v) return;
        subs.push({ id: uid(), title: v, done: false });
        newSub.value = '';
        saveSubs(true);
        drawSubs();
        newSub.focus(); // (rebuilding the list moved the field, which drops the focus)
      });
      function drawSubs() {
        subList.replaceChildren(...subs.map((s) => {
          const inp = h('input', { class: 'rem-sub-input', value: s.title, dir: 'auto', maxlength: 300, 'aria-label': t('rem.subtask') });
          inp.addEventListener('input', () => {
            s.title = inp.value;
            saveSubs();
          });
          inp.addEventListener('focus', () => (focusSub = s));
          inp.addEventListener('blur', () => {
            focusSub = null;
            if (!s.title.trim()) {
              subs = subs.filter((x) => x !== s);
              saveSubs(true);
              drawSubs();
            }
          });
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              newSub.focus();
            }
          });
          const chk = h('button', { class: ['rem-check', 'small', s.done && 'done'], role: 'checkbox', 'aria-checked': String(!!s.done), 'aria-label': s.title, html: icon('check', 13) });
          chk.addEventListener('click', () => {
            s.done = !s.done;
            saveSubs(true);
            drawSubs();
          });
          const del = h('button', { class: 'rem-sub-del', title: t('common.remove'), 'aria-label': t('common.remove'), html: icon('close', 16) });
          del.addEventListener('click', () => {
            subs = subs.filter((x) => x !== s);
            saveSubs(true);
            drawSubs();
          });
          return h('div', { class: ['rem-sub', s.done && 'done'], dataset: { id: s.id } }, chk, inp, del);
        }), h('div', { class: 'rem-sub rem-sub-new' }, h('span', { class: 'rem-sub-plus', html: icon('plus', 16) }), newSub));
      }
      const subCard = h('div', { class: 'ou-card rem-edit-subs' }, h('div', { class: 'rem-edit-label' }, h('span', { html: icon('rmSub', 18) }), t('rem.subtasks')), subList);

      // ——— notes ———
      const notes = h('textarea', { class: 'ou-input rem-edit-notes', rows: 3, placeholder: t('rem.notesPh'), value: r0.notes || '', dir: 'auto' });
      notes.addEventListener('input', () => {
        fit(notes);
        save({ notes: notes.value });
      });
      const notesCard = h('div', { class: 'ou-card rem-edit-notesbox' }, notes);
      // Writing assist (Galaxy AI, on-device): its button sits in the notes field while it has the focus. The field
      // gets normal input events when the text changes, so the notes save as if typed.
      import('../shell/writing.js').then((W) => W.attachWritingAssist?.(notes, { kind: 'reminder', onResult: () => fit(notes) }), (e) => console.error('writing assist', e));

      // ——— link ———
      const link = h('input', { class: 'rem-link-input', type: 'url', placeholder: t('rem.linkPh'), value: r0.url || '', 'aria-label': t('rem.link'), dir: 'ltr', spellcheck: 'false' });
      const openLink = h('button', { class: 'ou-icon-btn rem-link-open', title: t('common.openNewTab'), 'aria-label': t('common.openNewTab'), html: icon('external', 20), hidden: !r0.url });
      const normUrl = (v) => (v = v.trim()) ? toUrl(v) || (/^[\w-]+(\.[\w-]+)+/.test(v) ? 'https://' + v : v) : '';
      const commitLink = () => {
        const u = normUrl(link.value);
        if (u !== link.value) link.value = u;
        openLink.hidden = !/^https?:\/\//i.test(u);
        save({ url: u || null }, true);
      };
      link.addEventListener('change', commitLink);
      link.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), link.blur()));
      openLink.addEventListener('click', () => {
        const u = normUrl(link.value);
        if (/^https?:\/\//i.test(u)) window.open(u, '_blank', 'noopener');
      });
      const linkCard = h('div', { class: 'ou-card rem-edit-link' }, h('span', { class: 'rem-edit-ico', html: icon('link', 20) }), link, openLink);

      // ——— pictures ———
      let imgs = [...(r0.imgs || [])];
      const imgBox = h('div', { class: 'rem-imgs' });
      const addImg = h('button', { class: 'rem-img-add', title: t('rem.addImage'), 'aria-label': t('rem.addImage'), html: icon('image', 22) });
      addImg.addEventListener('click', async () => {
        const files = await pickFile('image/*', true);
        for (const f of (files || []).slice(0, MAX_IMGS - imgs.length)) {
          try {
            const iid = uid();
            pendingImages.add('reminder:' + iid);
            await putBlob('reminder:' + iid, await dataUrlToBlob(await readImage(f, 1600, 0.86)));
            imgs.push(iid);
          } catch (e) {
            console.error(e);
          }
        }
        save({ imgs: [...imgs] }, true);
        drawImgs();
      });
      function drawImgs() {
        imgBox.replaceChildren(...imgs.map((iid) => {
          const img = h('img', { alt: '', draggable: 'false' });
          blobUrl('reminder:' + iid).then((u) => u && (img.src = u));
          return h('button', { class: 'rem-img', dataset: { id: iid }, onClick: () => viewImage(iid) }, img);
        }), imgs.length < MAX_IMGS ? addImg : null);
      }
      async function viewImage(iid) {
        const img = h('img', { class: 'rem-viewer-img', alt: '' });
        blobUrl('reminder:' + iid).then((u) => u && (img.src = u));
        const v = await dialog({ className: 'rem-viewer', content: img, actions: [{ label: t('common.delete'), value: 'del', danger: true }, { label: t('common.close'), value: null, primary: true }] });
        if (v !== 'del') return;
        imgs = imgs.filter((x) => x !== iid);
        save({ imgs: [...imgs] }, true);
        drawImgs();
      }
      const imgCard = h('div', { class: 'ou-card rem-edit-imgs' }, h('div', { class: 'rem-edit-label' }, h('span', { html: icon('image', 18) }), t('rem.images')), imgBox);

      // ——— bottom button ———
      const doneBtn = isDraft
        ? h('button', { class: 'ou-btn primary rem-edit-save', onClick: () => app.ctx.pop() }, t('common.save'))
        : h('button', { class: 'ou-btn primary rem-edit-done', onClick: () => {
          flush();
          const r = cur();
          const undo = D.setDone(rid, !r.done);
          const now = D.find(rid);
          toast(!r.done ? (r.repeat && now && !now.done ? t('rem.doneNext', { when: fmtDue(now.due) }) : t('rem.completedToast')) : t('rem.restored'), { action: t('common.undo'), onAction: undo });
          app.ctx.pop();
        } }, r0.done ? t('rem.markUndone') : t('rem.markDone'));

      body.append(head, whenCard, h('div', { class: 'ou-card ou-list rem-edit-catcard' }, catRow), subCard, notesCard, linkCard, imgCard, doneBtn);
      drawWhen();
      drawCat();
      drawSubs();
      drawImgs();
      requestAnimationFrame(() => {
        fit(title);
        fit(notes);
      });
      setTimeout(() => {
        title.focus();
        title.setSelectionRange(title.value.length, title.value.length);
      }, 350);

      // another tab (or the notification's Done) deleting or completing it
      const off = store.on(M.KEY, () => {
        if (isDraft || gone) return;
        const r = D.find(rid);
        if (!r) {
          gone = true;
          app.ctx.pop();
        } else if (check) {
          check.classList.toggle('done', !!r.done);
          check.setAttribute('aria-checked', String(!!r.done));
        }
      });
      return () => {
        off();
        if (isDraft) {
          flush();
          if (!saved && !gone && (local.title || '').trim()) {
            saved = true;
            const r = D.addReminder(local);
            imgs.forEach((x) => pendingImages.delete('reminder:' + x));
            toast(t('rem.added'), { action: t('common.undo'), onAction: () => D.removeMany([r.id]) });
          }
        } else if (!gone) flush();
        imgs.forEach((x) => pendingImages.delete('reminder:' + x));
      };
    },
  });
  return pageObj;
}

const presetKey = (rp) => {
  const n = rp.n || 1, days = rp.days || [];
  if (n !== 1) return null;
  if (rp.end) return null;
  if (rp.f === 'd') return 'daily';
  if (rp.f === 'w' && !days.length) return 'weekly';
  if (rp.f === 'w' && days.length === 5 && [1, 2, 3, 4, 5].every((x) => days.includes(x))) return 'weekdays';
  if (rp.f === 'm') return 'monthly';
  if (rp.f === 'y') return 'yearly';
  return null;
};

/** Custom repeat: every n days/weeks/months/years, on these weekdays, until a date. Resolves the repeat, null for
 *  none, or undefined when cancelled. */
async function customRepeat(rp, due) {
  let f = rp?.f || 'd', days = rp?.days?.slice() || [new Date(due || Date.now()).getDay()], end = rp?.end || null;
  const n = h('input', { class: 'ou-input rem-rep-n', type: 'number', min: 1, max: 99, value: rp?.n || 1, 'aria-label': t('rem.rep.every') });
  const unit = seg([['d', t('rem.rep.days')], ['w', t('rem.rep.weeks')], ['m', t('rem.rep.months')], ['y', t('rem.rep.years')]].map(([value, label]) => ({ value, label })), f, (v) => {
    f = v;
    wdBox.hidden = f !== 'w';
  });
  const names = weekdayNames('narrow'), long = weekdayNames('long');
  const wdBox = h('div', { class: 'rem-rep-days', hidden: f !== 'w' });
  const drawDays = () => wdBox.replaceChildren(...[0, 1, 2, 3, 4, 5, 6].map((d) => h('button', {
    class: ['rem-rep-day', days.includes(d) && 'on'], title: long[d], 'aria-label': long[d], 'aria-pressed': String(days.includes(d)),
    onClick: () => {
      days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
      drawDays();
    },
  }, names[d])));
  drawDays();
  const endDate = h('input', { class: 'ou-input', type: 'date', value: end ? toDateInput(new Date(end)) : '', hidden: !end, 'aria-label': t('rem.rep.endDate') });
  const endSw = switchRow({ title: t('rem.rep.end'), checked: !!end, onChange: (on) => {
    endDate.hidden = !on;
    if (on && !endDate.value) endDate.value = toDateInput(new Date((due || Date.now()) + 30 * 864e5));
  } });
  const v = await dialog({
    title: t('rem.rep.custom'),
    className: 'rem-rep-dlg',
    content: h('div', { class: 'ou-dialog-body rem-rep' }, h('div', { class: 'rem-rep-line' }, h('span', null, t('rem.rep.every')), n), unit, wdBox, h('div', { class: 'ou-list rem-rep-end' }, endSw), endDate),
    actions: [{ label: t('common.cancel'), value: undefined }, { label: t('common.done'), primary: true, value: () => 'ok' }],
  });
  if (v !== 'ok') return undefined;
  const out = { f, n: Math.max(1, Math.min(99, Math.round(+n.value) || 1)) };
  if (f === 'w' && days.length) out.days = days.sort();
  if (!endDate.hidden && endDate.value) {
    const [y, mo, d] = endDate.value.split('-').map(Number);
    out.end = new Date(y, mo - 1, d).getTime();
  }
  return out;
}
