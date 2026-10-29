// Voice Recorder (Samsung Voice Recorder on One UI): the recording screen — Standard / Interview / Speech-to-text
// tabs, the big timer, the live scrolling waveform with the red playhead, and Bookmark · Record/Pause · Stop at the
// bottom; Stop asks for a name and category ("Save recording"). The list, playback, edit, Recycle bin and settings
// screens are pushed on top (list.js, play.js). A recording goes on when the window closes (engine.js).
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { store } from '../core/store.js';
import { toast, menu, dialog, seg, iconBtn, prompt } from '../core/ui.js';
import * as M from './model.js';
import { D, byId, patch, prefs, setPrefs, purge, addCat } from './data.js';
import * as E from './engine.js';
import { createPlayer } from './audio.js';
import { drawScroll } from './wave.js';
import { MODE_ICON, modeName, micError, fresh, detectStt, langName, rulerText } from './common.js';
import { listPage, binPage, settingsPage, catsPage } from './list.js';
import { playPage, editPage } from './play.js';

export async function render(ctx) {
  purge();
  E.recover().catch((e) => console.warn('recorder recover', e));
  const playerSubs = new Set();
  const player = createPlayer(() => playerSubs.forEach((fn) => fn()));
  const env = {
    ctx,
    player,
    playerSubs,
    stt: { ok: false, lang: 'en-US', state: 'unavailable' },
    openList: (hl) => listPage(env, hl),
    openPlay: (id) => playPage(env, id),
    openEdit: (id) => editPage(env, id),
    openBin: () => binPage(env),
    openSettings: () => settingsPage(env),
    openCats: () => catsPage(env),
  };
  const main = (env.main = mainPage(env));
  detectStt(env).then(() => main.draw());

  const toRoot = () => {
    while (ctx.depth > 1) ctx.pop();
  };
  ctx.setParams = (p = {}) => {
    if (p.id) {
      const m = fresh(p.id);
      if (m && !m.rec) {
        toRoot();
        env.openPlay(p.id);
      }
    } else if (p.record || p.section === 'record') {
      toRoot();
      main.startRec();
    } else if (p.section === 'list') env.openList();
  };
  ctx.setParams(ctx.params || {});
  return () => {
    main.dispose();
    player.destroy();
  };
}

// ------------------------------------------------------------------ the recording screen
function mainPage(env) {
  const { ctx } = env;
  let mode = prefs().mode, raf = 0, segMade = '';
  const listBtn = h('button', { class: 'rec-tb-text', onClick: () => env.openList() }, t('recorder.list'));
  const moreBtn = iconBtn('more', (e) => menu(e.currentTarget, [
    { label: t('recorder.bin'), icon: 'trash', onClick: () => env.openBin() },
    { label: t('common.settings'), icon: 'settings', onClick: () => env.openSettings() },
  ], { align: 'end' }), t('common.more'));
  const page = ctx.page({ title: '', hero: false, className: 'rec-page rec-main-page', actions: [listBtn, moreBtn] });
  page.body.classList.add('flush');

  const modesEl = h('div', { class: 'rec-modes' });
  const modeLbl = h('div', { class: 'rec-modelbl' });
  const timer = h('div', { class: 'rec-timer', dir: 'ltr', role: 'timer' }, M.fmtClock(0));
  const canvas = h('canvas', { class: 'rec-wave', 'aria-hidden': 'true' });
  const person = (n, cls) => h('span', { class: ['rec-person', cls] }, h('span', { html: icon('rec-person', 16) }), t('recorder.person', { n }));
  const stage = h('div', { class: 'rec-stage', dir: 'ltr' }, canvas, person(1, 'top'), person(2, 'bottom'));
  const sttBox = h('div', { class: 'rec-sttbox', 'aria-live': 'polite' });
  const hint = h('div', { class: 'rec-hint' });
  const sideBtn = (cls, ic, label, onClick) =>
    h('button', { class: ['rec-side', cls], title: label, 'aria-label': label, onClick }, h('span', { class: 'rec-side-ico', html: icon(ic, 24) }), h('span', { class: 'rec-side-lbl' }, label));
  const markBtn = sideBtn('rec-markbtn', 'rec-flag', t('recorder.bookmark'), () => addMark());
  const stopBtn = sideBtn('rec-stopbtn', 'stop', t('recorder.stop'), () => onStop());
  const mainBtn = h('button', { class: 'rec-btn', onClick: () => onMain() }, h('span', { class: 'rec-btn-in' }));
  const markCount = h('span', { class: 'rec-markn' });
  markBtn.querySelector('.rec-side-ico').appendChild(markCount);
  const root = h('div', { class: 'rec-main' }, modesEl, modeLbl, timer, stage, sttBox, hint, h('div', { class: 'rec-ctrls' }, markBtn, mainBtn, stopBtn));
  page.body.appendChild(root);

  function buildModes() {
    const key = String(env.stt.ok);
    if (segMade === key) return;
    segMade = key;
    const opts = [{ value: 'std', label: modeName('std') }, { value: 'interview', label: modeName('interview') }];
    if (env.stt.ok) opts.push({ value: 'stt', label: modeName('stt') });
    if (!opts.some((o) => o.value === mode)) mode = 'std';
    modesEl.replaceChildren(seg(opts, mode, (v) => {
      mode = v;
      setPrefs({ mode: v });
      draw();
    }));
  }

  function draw() {
    const a = E.active();
    const m = a ? a.mode : mode;
    buildModes();
    root.classList.toggle('recording', !!a);
    root.classList.toggle('paused', !!a?.paused);
    for (const k of M.MODES) root.classList.toggle('m-' + k, m === k);
    stage.classList.toggle('split', m === 'interview');
    modeLbl.replaceChildren(h('span', { html: icon(MODE_ICON[m], 18) }), modeName(m));
    const label = !a ? t('recorder.record') : a.paused ? t('recorder.resume') : t('recorder.pause');
    mainBtn.title = label;
    mainBtn.setAttribute('aria-label', label);
    mainBtn.dataset.state = !a ? 'idle' : a.paused ? 'paused' : 'rec';
    mainBtn.querySelector('.rec-btn-in').innerHTML = !a || a.paused ? '' : icon('pause', 30);
    markCount.textContent = a?.marks.length ? String(a.marks.length) : '';
    hint.textContent = a?.sttFatal ? t('recorder.stt.error') : !a && m === 'interview' ? t('recorder.hint.interview') : !a && m === 'stt' ? t('recorder.hint.stt', { lang: langName(env.stt.lang) }) : '';
    drawStt(a);
    paint();
  }
  function drawStt(a) {
    const on = (a ? a.mode : mode) === 'stt';
    sttBox.hidden = !on;
    if (!on) return;
    if (!a || (!a.text.length && !a.interim)) {
      sttBox.replaceChildren(h('div', { class: 'rec-stt-ph' }, a ? t('recorder.stt.listening') : t('recorder.stt.ph')));
      return;
    }
    sttBox.replaceChildren(...a.text.map((p) => h('p', { dir: 'auto' }, p.s)), ...(a.interim ? [h('p', { class: 'interim', dir: 'auto' }, a.interim)] : []));
    sttBox.scrollTop = sttBox.scrollHeight;
  }
  function paint() {
    cancelAnimationFrame(raf);
    raf = 0;
    const a = E.active();
    const sec = a ? E.elapsed() : 0;
    timer.textContent = M.fmtClock(sec);
    if (!page.el.classList.contains('behind') && canvas.isConnected && canvas.offsetWidth) {
      const m = a ? a.mode : mode;
      drawScroll(canvas, { pk: a?.levels, pk2: a?.levels2, split: m === 'interview', pr: E.LEVEL_RATE, t: sec, len: sec, recording: true, marks: a?.marks.map((b) => b.t), label: rulerText, pxps: 60 });
    }
    if (a && !a.paused) raf = requestAnimationFrame(paint);
  }

  async function startRec() {
    if (E.active()) return;
    env.player.pause();
    let m = mode;
    if (m === 'stt') {
      if (!env.stt.ok) m = 'std';
      else if (env.stt.state !== 'available' && !(await askDownload(env))) return;
    }
    mainBtn.disabled = true;
    try {
      await E.start({ mode: m, lang: env.stt.lang });
    } catch (e) {
      micError(e);
    } finally {
      mainBtn.disabled = false;
    }
    draw();
  }
  function onMain() {
    const a = E.active();
    if (!a) return startRec();
    if (a.paused) E.resume();
    else E.pause();
  }
  function addMark() {
    if (!E.active()) return;
    const n = E.mark();
    toast(n ? t('recorder.markAdded') : t('recorder.marksFull', { n: M.MAX_MARKS }), { duration: 1400 });
  }
  async function onStop() {
    const a = E.active();
    if (!a) return;
    const { id, title } = a;
    const saving = E.stop();
    if (!prefs().askName) {
      await saving;
      toast(t('recorder.savedAs', { name: title }));
      env.openList(id);
      return;
    }
    const res = await saveDialog(id, title);
    await saving;
    if (res === 'discard') {
      await E.discard(id);
      toast(t('recorder.discarded'));
      return;
    }
    if (byId(id)) env.openList(id);
  }

  const off = E.onChange(() => draw());
  const offData = store.on('recorder', () => buildModes());
  // the window zooms in, maximizes and resizes: redraw the canvas at its new size
  const ro = new ResizeObserver(() => paint());
  ro.observe(stage);
  page.onReturn = () => requestAnimationFrame(() => draw());
  draw();
  return {
    draw,
    startRec,
    dispose() {
      cancelAnimationFrame(raf);
      off();
      offData();
      ro.disconnect();
    },
  };
}

/** "Save recording": name and category; Discard throws it away (after asking). Resolves 'save' | 'discard'. */
async function saveDialog(id, title) {
  const input = h('input', { class: 'ou-input', value: title, maxlength: 120, 'aria-label': t('recorder.det.name'), spellcheck: 'false' });
  let cat = byId(id)?.cat || '';
  const catLbl = h('span', null);
  const setLbl = () => (catLbl.textContent = cat ? D().cats.find((c) => c.id === cat)?.name || t('recorder.cat.none') : t('recorder.cat.none'));
  setLbl();
  const catBtn = h('button', {
    class: 'rec-save-cat',
    onClick: () =>
      menu(catBtn, [
        { label: t('recorder.cat.none'), checked: !cat, onClick: () => ((cat = ''), setLbl()) },
        ...D().cats.map((c) => ({ label: c.name, checked: cat === c.id, onClick: () => ((cat = c.id), setLbl()) })),
        '-',
        {
          label: t('recorder.cat.add'),
          icon: 'plus',
          onClick: async () => {
            const v = (await prompt(t('recorder.cat.add'), { placeholder: t('recorder.cat.name'), okLabel: t('common.add') }))?.trim();
            if (v) {
              cat = addCat(v);
              setLbl();
            }
          },
        },
      ], { align: 'end' }),
  }, h('span', { html: icon('rec-tag', 18) }), catLbl, h('span', { html: icon('down', 16) }));
  setTimeout(() => input.select(), 80);
  const res = await dialog({
    title: t('recorder.saveTitle'),
    className: 'rec-save-dlg',
    content: h('div', { class: 'ou-dialog-body rec-save' }, input, h('div', { class: 'rec-save-row' }, h('span', null, t('recorder.category')), catBtn)),
    actions: [{ label: t('recorder.discard'), value: 'discard', danger: true }, { label: t('common.save'), value: 'save', primary: true }],
  });
  if (res === 'discard') {
    const sure = await dialog({ title: t('recorder.discardQ'), message: t('recorder.discardMsg'), actions: [{ label: t('common.cancel'), value: false }, { label: t('recorder.discard'), value: true, danger: true }] });
    if (sure) return 'discard';
  }
  // dismissing the dialog keeps the recording under its default name
  const name = input.value.trim() || title;
  patch(id, { title: name.slice(0, 120), cat: cat || undefined });
  return 'save';
}

/** Speech-to-text needs Chrome's on-device speech model for the language; it's downloaded once, after asking. */
async function askDownload(env) {
  const ok = await dialog({
    title: t('recorder.stt.dlTitle'),
    message: t('recorder.stt.dlMsg', { lang: langName(env.stt.lang) }),
    actions: [{ label: t('common.cancel'), value: false }, { label: t('recorder.stt.download'), value: true, primary: true }],
  });
  if (!ok) return false;
  toast(t('recorder.stt.downloading'), { duration: 120000 });
  const done = await E.sttInstall(env.stt.lang);
  env.stt.state = await E.sttAvailability(env.stt.lang);
  if (!done || env.stt.state !== 'available') {
    toast(t('recorder.stt.dlFailed'));
    return false;
  }
  toast(t('recorder.stt.ready'), { duration: 1500 });
  return true;
}
