// The entry editor, a page pushed over the Journal: date and journal, the moment or reflection it started from,
// photos and drawings, a title, rich text (bold, italic, underline, strikethrough, lists), mood, place and tags.
// Everything saves as you type; an entry left empty is dropped when you leave, like Samsung Notes.
import { h, uid, debounce, pickFile, readImage } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtTime } from '../core/i18n.js';
import { store } from '../core/store.js';
import { toast, menu, dialog, confirm } from '../core/ui.js';
import { putBlob, getBlob, dataUrlToBlob } from '../core/blobs.js';
import * as M from './model.js';
import { D, mut, dropBlobs, pl } from './data.js';
import { clean, toText } from './rich.js';
import { journalName, longDate, hydrate, momentRow } from './common.js';
import { moodFace, moodName, pickMood, feelingName, areaName } from './mood.js';
import { promptText } from './prompts.js';
import { drawDialog, readStrokes } from './draw.js';
import { pickSuggestion, exportEntries, editDate } from './sheets.js';

/** Opens an entry (id) or a new one (draft fields) on a pushed page. */
export function openEditor(ctx, { id, draft = {} } = {}) {
  const stored = id ? M.byId(D(), id) : null;
  if (id && !stored) return toast(t('journal.gone'));
  const e = stored ? structuredClone(stored) : M.newEntry(D(), draft);
  let saved = !!stored, closed = false;
  const dropped = []; // pictures taken out of the entry: they leave IndexedDB when the editor closes

  ctx.push({
    title: '',
    hero: false,
    className: 'jr-edit-page',
    render(body, page) {
      body.classList.add('jr-ed-body');
      const bmBtn = h('button', { class: 'ou-icon-btn jr-ed-bm', onClick: () => { e.bookmark = !e.bookmark || undefined; drawHead(); save(); } });
      const moodBtn = h('button', { class: 'ou-icon-btn jr-ed-moodbtn', title: t('journal.mood'), 'aria-label': t('journal.mood'), onClick: () => logMood() });
      const moreBtn = h('button', { class: 'ou-icon-btn', title: t('common.more'), 'aria-label': t('common.more'), html: icon('more', 22), onClick: (ev) => moreMenu(ev.currentTarget) });
      page.setActions([bmBtn, moodBtn, moreBtn]);
      const dateBtn = h('button', { class: 'jr-ed-date', onClick: () => setDate() });
      const jBtn = h('button', { class: 'jr-ed-journal', onClick: (ev) => moveTo(ev.currentTarget) });
      const att = h('div', { class: 'jr-ed-att' });
      const media = h('div', { class: 'jr-ed-media' });
      const titleIn = h('input', { class: 'jr-ed-title', dir: 'auto', placeholder: t('journal.titlePh'), 'aria-label': t('journal.titlePh'), maxlength: 200, value: e.title || '' });
      const text = h('div', { class: 'jr-ed-text', dir: 'auto', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('journal.entry'), 'data-ph': t('journal.textPh'), html: clean(M.htmlOf(e)) });
      const extra = h('div', { class: 'jr-ed-extra' });
      const foot = h('div', { class: 'jr-ed-foot' });
      body.append(h('div', { class: 'jr-ed' }, h('div', { class: 'jr-ed-meta' }, dateBtn, jBtn), att, media, titleIn, text, extra, foot));

      // ——— the floating toolbar: format row (Aa) over the tools ———
      const fmtBtn = (cmd, inner, label) => h('button', { class: 'jr-fmt', dataset: { cmd }, title: label, 'aria-label': label, html: inner, onMousedown: (ev) => ev.preventDefault(), onClick: () => exec(cmd) });
      const txt = (s, style) => `<span class="jr-fmt-txt" style="${style}">${s}</span>`;
      const fmtRow = h('div', { class: 'jr-fmtrow', hidden: true },
        fmtBtn('bold', txt('B', 'font-weight:800'), t('journal.bold')),
        fmtBtn('italic', txt('I', 'font-style:italic;font-family:Georgia,serif'), t('journal.italic')),
        fmtBtn('underline', txt('U', 'text-decoration:underline'), t('journal.underline')),
        fmtBtn('strikeThrough', txt('S', 'text-decoration:line-through'), t('journal.strike')),
        h('span', { class: 'jr-fmt-sep' }),
        fmtBtn('insertUnorderedList', icon('list', 20), t('journal.bullets')),
        fmtBtn('insertOrderedList', icon('jr-numlist', 20), t('journal.numbers')));
      const tool = (name, ic, label, fn) => h('button', { class: 'jr-tool', dataset: { tool: name }, title: label, 'aria-label': label, html: icon(ic, 22), onMousedown: (ev) => name === 'format' && ev.preventDefault(), onClick: fn });
      const bar = h('div', { class: 'jr-ed-bar' }, fmtRow, h('div', { class: 'jr-toolrow', role: 'toolbar' },
        tool('format', 'jr-format', t('journal.format'), () => { fmtRow.hidden = !fmtRow.hidden; bar.querySelector('[data-tool="format"]').classList.toggle('on', !fmtRow.hidden); syncFmt(); }),
        tool('photo', 'image', t('journal.addPhotos'), async () => addPhotos(await pickFile('image/*', true))),
        tool('draw', 'jr-nib', t('journal.drawing'), () => drawing(null)),
        tool('mood', 'jr-smile', t('journal.mood'), () => logMood()),
        tool('place', 'location', t('journal.place'), () => setPlace()),
        tool('tag', 'jr-tag', t('journal.addTag'), () => addTagDlg()),
        tool('suggest', 'sparkle', t('journal.suggestions'), () => suggest())));
      page.el.appendChild(bar);
      import('../shell/writing.js').then((m) => m.attachWritingAssist(text, { kind: 'journal', bar: bar.querySelector('.jr-toolrow'), btnClass: 'jr-tool' }));

      function drawHead() {
        dateBtn.replaceChildren(h('span', { html: icon('calendar', 16) }), h('span', null, `${longDate(e.at)} · ${fmtTime(new Date(e.at))}`));
        const d = D(), j = M.journalById(d, M.journalOf(d, e));
        jBtn.style.setProperty('--jc', j?.color || M.ACCENT);
        jBtn.replaceChildren(h('i', { class: 'jr-jdot' }), h('span', null, journalName(j)), h('span', { html: icon('down', 14) }));
        bmBtn.innerHTML = icon(e.bookmark ? 'jr-bookmark-fill' : 'bookmark', 22);
        bmBtn.classList.toggle('active', !!e.bookmark);
        bmBtn.title = e.bookmark ? t('journal.unbookmark') : t('journal.bookmark');
        bmBtn.setAttribute('aria-label', bmBtn.title);
        bmBtn.setAttribute('aria-pressed', String(!!e.bookmark));
        moodBtn.innerHTML = e.mood ? moodFace(e.mood.level, 26) : icon('jr-smile', 22);
      }
      function drawAtt() {
        const parts = [];
        if (e.moment) {
          const row = momentRow(e.moment, 'jr-ed-mo');
          if (e.moment.list?.length > 1) row.querySelector('.jr-mo-t').append(h('span', { class: 'jr-ed-mo-list' }, e.moment.list.map((s) => h('span', null, s))));
          row.append(h('button', { class: 'jr-x', title: t('common.remove'), 'aria-label': t('common.remove'), html: icon('close', 16), onClick: () => { delete e.moment; drawAtt(); save(); } }));
          parts.push(row);
        }
        if (e.prompt && M.isPrompt(e.prompt)) {
          parts.push(h('div', { class: 'jr-ed-q' },
            h('span', { class: 'jr-ed-q-lab' }, h('span', { html: icon('sparkle', 14) }), t('journal.reflection')),
            h('p', null, promptText(e.prompt)),
            h('button', { class: 'jr-x', title: t('common.remove'), 'aria-label': t('common.remove'), html: icon('close', 16), onClick: () => { delete e.prompt; drawAtt(); save(); } })));
        }
        att.replaceChildren(...parts);
      }
      function drawMedia() {
        const list = e.media || [];
        media.hidden = !list.length;
        media.replaceChildren(...list.map((m) => h('div', { class: ['jr-ph', 'jr-ed-ph', m.k === 'draw' && 'draw'], role: 'button', tabindex: 0, 'aria-label': m.k === 'draw' ? t('journal.drawing') : t('journal.photo'), onClick: () => (m.k === 'draw' ? drawing(m) : viewPhoto(m.id)), onKeydown: (ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), ev.currentTarget.click()) },
          h('img', { dataset: { blob: m.id }, alt: '' }),
          h('button', { class: 'jr-x', title: t('common.remove'), 'aria-label': t('common.remove'), html: icon('close', 14), onClick: (ev) => { ev.stopPropagation(); removeMedia(m); } }))),
        h('button', { class: 'jr-ed-addph', title: t('journal.addPhotos'), 'aria-label': t('journal.addPhotos'), html: icon('plus', 26), onClick: async () => addPhotos(await pickFile('image/*', true)) }));
        hydrate(media);
      }
      function drawExtra() {
        const parts = [];
        if (e.mood) {
          const m = M.moodOf(e.mood.level);
          const labels = [...(e.mood.feelings || []).map(feelingName), ...(e.mood.areas || []).map(areaName)];
          parts.push(h('button', { class: 'jr-ed-mood', style: { '--mc': m.color }, onClick: () => logMood() },
            h('span', { html: moodFace(m.level, 40) }),
            h('span', { class: 'jr-ed-mood-t' }, h('small', null, t('journal.moodLogged')), h('b', null, moodName(m.level)), labels.length ? h('span', null, labels.join(t('journal.comma'))) : null)));
        }
        const chips = [];
        if (e.place) chips.push(h('span', { class: 'jr-chip big' }, h('span', { html: icon('location', 15) }), h('button', { class: 'jr-chip-t', onClick: () => setPlace() }, e.place), h('button', { class: 'jr-chip-x', title: t('common.remove'), 'aria-label': t('common.remove'), html: icon('close', 13), onClick: () => { delete e.place; drawExtra(); save(); } })));
        for (const tg of e.tags || []) chips.push(h('span', { class: 'jr-chip big tag' }, h('span', { class: 'jr-chip-t' }, '#' + tg), h('button', { class: 'jr-chip-x', title: t('common.remove'), 'aria-label': t('common.remove'), html: icon('close', 13), onClick: () => { e.tags = e.tags.filter((x) => x !== tg); drawExtra(); save(); } })));
        if (chips.length) parts.push(h('div', { class: 'jr-chips' }, chips));
        extra.replaceChildren(...parts);
      }
      const drawFoot = () => {
        const n = M.words(`${titleIn.value} ${toText(clean(text.innerHTML))}`);
        foot.textContent = pl('journal.words', n);
      };
      const drawAll = () => { drawHead(); drawAtt(); drawMedia(); drawExtra(); drawFoot(); };
      const emptyText = () => text.classList.toggle('empty', !text.textContent.trim() && !text.querySelector('li'));
      drawAll();
      emptyText();
      if (!stored) setTimeout(() => !closed && text.focus(), 360);

      // ——— saving ———
      function collect() {
        const html = clean(text.innerHTML);
        e.title = titleIn.value.trim() || undefined;
        e.text = toText(html);
        if (html && e.text) e.html = html;
        else delete e.html;
        for (const k of ['title', 'moment', 'prompt', 'mood', 'bookmark', 'place']) if (!e[k]) delete e[k];
        if (!e.media?.length) delete e.media;
        if (!e.tags?.length) delete e.tags;
      }
      function persist() {
        collect();
        if (M.isBlank(e) && !saved) return;
        e.edited = Date.now();
        mut((d) => {
          const i = d.entries.findIndex((x) => x.id === e.id);
          if (i >= 0) d.entries[i] = { ...e, ...(d.entries[i].deletedAt ? { deletedAt: d.entries[i].deletedAt } : {}) };
          else d.entries.unshift({ ...e });
        });
        saved = true;
      }
      // a save still waiting when the editor closes (or the entry is deleted) must not bring the entry back
      const save = () => { if (!closed) persist(); };
      const saveSoon = debounce(() => save(), 400);
      titleIn.addEventListener('input', () => { saveSoon(); drawFoot(); });
      titleIn.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === 'ArrowDown') {
          ev.preventDefault();
          text.focus();
        }
      });
      text.addEventListener('input', (ev) => { autoList(ev); emptyText(); saveSoon(); drawFoot(); });
      // pasted text keeps only what the editor can show
      text.addEventListener('paste', (ev) => {
        ev.preventDefault();
        const html = ev.clipboardData.getData('text/html');
        const plainText = ev.clipboardData.getData('text/plain');
        const out = html ? clean(html) : M.textToHtml(plainText);
        document.execCommand('insertHTML', false, out || M.escHtml(plainText));
      });
      text.addEventListener('drop', (ev) => {
        const files = [...(ev.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return;
        ev.preventDefault();
        addPhotos(files);
      });
      text.addEventListener('keyup', syncFmt);
      text.addEventListener('mouseup', syncFmt);

      // "- " or "* " starts a bulleted list and "1. " a numbered one, as in Samsung Notes
      function autoList(ev) {
        if (ev.inputType !== 'insertText' || ev.data !== ' ') return;
        const node = getSelection().anchorNode;
        if (!node || node.nodeType !== 3 || !text.contains(node) || node.parentElement.closest('li')) return;
        const s = node.nodeValue.slice(0, getSelection().anchorOffset).replace(/ /g, ' ');
        if (!/^([-*•]|1[.)]) $/.test(s)) return;
        const r = document.createRange();
        r.setStart(node, 0);
        r.setEnd(node, s.length);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        document.execCommand('delete');
        document.execCommand(s.startsWith('1') ? 'insertOrderedList' : 'insertUnorderedList');
      }
      function exec(cmd) {
        if (!text.contains(getSelection().anchorNode)) {
          text.focus();
          const r = document.createRange();
          r.selectNodeContents(text);
          r.collapse(false);
          getSelection().removeAllRanges();
          getSelection().addRange(r);
        }
        document.execCommand(cmd);
        emptyText();
        saveSoon();
        syncFmt();
      }
      function syncFmt() {
        if (fmtRow.hidden) return;
        fmtRow.querySelectorAll('[data-cmd]').forEach((b) => {
          let on = false;
          try {
            on = text.contains(getSelection().anchorNode) && document.queryCommandState(b.dataset.cmd);
          } catch {}
          b.classList.toggle('on', on);
        });
      }

      // ——— photos and drawings ———
      async function addPhotos(files) {
        files = (Array.isArray(files) ? files : [files]).filter((f) => f && /^image\//.test(f.type));
        if (!files.length) return;
        e.media ||= [];
        for (const f of files.slice(0, 20)) {
          try {
            const id = 'journal:' + uid();
            await putBlob(id, await dataUrlToBlob(await readImage(f, 2048, 0.86)));
            e.media.push({ id, k: 'photo' });
          } catch (err) {
            console.warn('journal photo', err);
          }
        }
        if (closed) return;
        drawMedia();
        save();
      }
      function removeMedia(m) {
        dropped.push(m.id, m.vec);
        e.media = (e.media || []).filter((x) => x.id !== m.id);
        drawMedia();
        save();
      }
      async function drawing(existing) {
        const vec = existing?.vec ? await getBlob(existing.vec).catch(() => null) : null;
        const r = await drawDialog(vec ? await readStrokes(vec) : []);
        if (!r || closed) return;
        const m = existing || { id: 'journal:' + uid(), k: 'draw', vec: 'journal:' + uid() };
        await putBlob(m.id, r.png);
        await putBlob(m.vec, r.vector);
        if (!existing) (e.media ||= []).push(m);
        drawMedia();
        save();
      }
      function viewPhoto(id) {
        const img = h('img', { class: 'jr-viewer-img', dataset: { blob: id }, alt: '' });
        const box = h('div', { class: 'jr-viewer' }, img);
        hydrate(box);
        dialog({ className: 'jr-viewer-dlg', content: box, actions: [{ label: t('common.close'), value: null, primary: true }] });
      }

      // ——— mood, place, tags, suggestions ———
      async function logMood() {
        const r = await pickMood(e.mood);
        if (r == null || closed) return;
        if (r === 'remove') delete e.mood;
        else e.mood = { level: r.level, ...(r.feelings.length ? { feelings: r.feelings } : {}), ...(r.areas.length ? { areas: r.areas } : {}) };
        drawHead();
        drawExtra();
        save();
      }
      async function setPlace() {
        const input = h('input', { class: 'ou-input', placeholder: t('journal.placePh'), value: e.place || '', maxlength: 80 });
        const city = store.get('weather')?.location?.name || store.get('settings')?.location?.name || '';
        const quick = city && city !== e.place ? h('div', { class: 'ou-chips' }, h('button', { class: 'ou-chip', onClick: () => { input.value = city; input.focus(); } }, h('span', { html: icon('navigation', 14) }), city)) : null;
        const actions = [];
        if (e.place) actions.push({ label: t('common.remove'), value: '', danger: true });
        actions.push({ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => input.value, primary: true });
        const v = await dialog({ title: t('journal.place'), content: h('div', { class: 'ou-dialog-body' }, input, quick), actions });
        if (v == null || closed) return;
        if (v.trim()) e.place = v.trim();
        else delete e.place;
        drawExtra();
        save();
      }
      async function addTagDlg() {
        const input = h('input', { class: 'ou-input', placeholder: t('journal.tagPh'), maxlength: 32 });
        const known = M.topTags(D(), 10).map(([x]) => x).filter((x) => !(e.tags || []).includes(x));
        const quick = known.length ? h('div', { class: 'ou-chips jr-wrap-chips' }, known.map((x) => h('button', { class: 'ou-chip', onClick: () => { input.value = x; input.focus(); } }, '#' + x))) : null;
        const v = await dialog({ title: t('journal.addTag'), content: h('div', { class: 'ou-dialog-body' }, input, quick), actions: [{ label: t('common.cancel'), value: null }, { label: t('common.add'), value: () => input.value, primary: true }] });
        if (!v || closed) return;
        for (const part of v.split(/[,\n]+/)) e.tags = M.addTag(e.tags, part);
        drawExtra();
        save();
      }
      async function suggest() {
        const pick = await pickSuggestion();
        if (!pick || closed) return;
        if (pick.moment) e.moment = pick.moment;
        if (pick.prompt) e.prompt = pick.prompt;
        drawAtt();
        save();
      }
      async function setDate() {
        const at = await editDate(e.at);
        if (!at || closed) return;
        e.at = at;
        drawHead();
        save();
      }
      function moveTo(anchor) {
        const d = D();
        menu(anchor, d.journals.map((j) => ({ label: journalName(j), checked: M.journalOf(d, e) === j.id, onClick: () => { e.journal = j.id; drawHead(); save(); } })));
      }
      function moreMenu(anchor) {
        const d = D();
        menu(anchor, [
          { label: t('journal.editDate'), icon: 'calendar', onClick: setDate },
          d.journals.length > 1 ? { label: t('journal.moveTo'), icon: 'folder', onClick: () => moveTo(anchor) } : null,
          { label: t('journal.copyText'), icon: 'copy', onClick: () => { collect(); navigator.clipboard?.writeText([e.title, e.text].filter(Boolean).join('\n\n')).then(() => toast(t('journal.copied'))).catch(() => {}); } },
          { label: t('journal.export'), icon: 'download', onClick: () => { collect(); exportEntries([{ ...e }], e.title || longDate(e.at)); } },
          '-',
          { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => removeEntry() },
        ], { align: 'end' });
      }
      async function removeEntry() {
        collect();
        if (!saved && M.isBlank(e)) return ctx.pop();
        if (!(await confirm(t('journal.deleteQ'), t('journal.deleteMsg'), { okLabel: t('common.delete'), danger: true }))) return;
        persist();
        closed = true;
        mut((d) => {
          const x = M.byId(d, e.id);
          if (x) x.deletedAt = Date.now();
        });
        toast(t('journal.movedToBin'), { action: t('common.undo'), onAction: () => mut((d) => { const x = M.byId(d, e.id); if (x) delete x.deletedAt; }) });
        ctx.pop();
      }

      // ——— keep the editor in step with other tabs (only while you aren't typing in it) ———
      const off = store.on(M.KEY, () => {
        if (closed || document.activeElement === titleIn || document.activeElement === text) return;
        const cur = M.byId(D(), e.id);
        if (!cur || cur.edited <= e.edited) return;
        Object.assign(e, structuredClone(cur));
        titleIn.value = e.title || '';
        text.innerHTML = clean(M.htmlOf(e));
        emptyText();
        drawAll();
      });

      // ——— leaving ———
      return () => {
        off();
        bar.remove();
        if (closed) return dropBlobs(dropped);
        closed = true;
        collect();
        if (M.isBlank(e)) {
          // an entry left empty isn't kept
          if (saved) mut((d) => { d.entries = d.entries.filter((x) => x.id !== e.id); });
          dropBlobs([...dropped, ...(e.media || []).flatMap((m) => [m.id, m.vec])]);
          return;
        }
        persist();
        dropBlobs(dropped);
      };
    },
  });
}
