// Voice Recorder playback and editing. Playback: the scrolling waveform (drag to scrub) with bookmarks and the red
// playhead, Interview recordings with Person 1 / Person 2 mute buttons, the Speech-to-text transcript that follows the
// audio, Bookmark, Repeat (A–B), Skip silence and Speed, rewind / play / forward. Edit: the whole recording with two
// handles, Trim (keep the selection) or Delete (cut it out), saved as a new recording or over the original.
import { h, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { store } from '../core/store.js';
import { blobUrl } from '../core/blobs.js';
import { toast, menu, dialog, prompt, iconBtn, slider } from '../core/ui.js';
import * as M from './model.js';
import { D, byId, patch, duplicate, catName } from './data.js';
import * as E from './engine.js';
import { drawScroll, drawFit } from './wave.js';
import { MODE_ICON, modeName, dateText, renameRec, shareRec, saveFile, canShare, changeCategory, trashRecs, details, copyText, fresh, rulerText } from './common.js';

const SKIP = 5; // seconds for rewind / forward
const PXPS = 60; // waveform pixels per second

/** Peaks of the edited recording, cached per recording + edits. */
function peaksCache() {
  let key = '', val = null, val2 = null;
  return (m, segs = m.segs) => {
    const k = m.id + ':' + (m.pk || '').length + ':' + (m.pk || '').slice(-16) + ':' + JSON.stringify(segs || null);
    if (k !== key) {
      key = k;
      val = m.pk ? M.editedPeaks(M.decodePeaks(m.pk), m.pr, segs) : new Uint8Array(0);
      val2 = m.pk2 ? M.editedPeaks(M.decodePeaks(m.pk2), m.pr, segs) : null;
    }
    return [val, val2];
  };
}

async function loadInto(player, m) {
  if (player.memo?.id === m.id) return player.refresh(m);
  const url = await blobUrl(M.blobKey(m.id));
  await player.load(m, url);
}

// ------------------------------------------------------------------ playback
export function playPage(env, id) {
  const { ctx, player } = env;
  let m = fresh(id);
  if (!m || m.rec) return null;
  const peaks = peaksCache();
  let raf = 0, drag = null, rep = 0, repA = 0, lastSeg = -1;
  const markTb = iconBtn('rec-flag', () => marksDialog(), t('recorder.bookmarks'));
  const moreBtn = iconBtn('more', (e) => moreMenu(e.currentTarget), t('common.more'));
  let page;
  page = ctx.push({
    title: m.title,
    hero: false,
    className: 'rec-page rec-play-page',
    actions: [markTb, moreBtn],
    render(body, pg) {
      page = pg;
      body.classList.add('flush');
      const meta = h('div', { class: 'rec-pmeta' });
      const canvas = h('canvas', { class: 'rec-wave' });
      const person = (n, cls) => h('span', { class: ['rec-person', cls] }, h('span', { html: icon('rec-person', 16) }), t('recorder.person', { n }));
      const stage = h('div', { class: 'rec-stage play', dir: 'ltr', title: t('recorder.dragHint') }, canvas, person(1, 'top'), person(2, 'bottom'));
      const persons = h('div', { class: 'rec-persons' });
      const textBox = h('div', { class: 'rec-ptext' });
      const cur = h('span', { class: 'rec-ptime-cur' }), tot = h('span', { class: 'rec-ptime-tot' });
      const times = h('div', { class: 'rec-ptime', dir: 'ltr' }, cur, tot);
      const opt = (cls, ic, label, fn) => h('button', { class: ['rec-opt', cls], onClick: fn, title: label }, h('span', { class: 'rec-opt-ico', html: icon(ic, 22) }), h('span', { class: 'rec-opt-lbl' }, label));
      const oMark = opt('o-mark', 'rec-flag', t('recorder.bookmark'), () => addMark());
      const oRep = opt('o-rep', 'rec-repeat', t('recorder.repeat'), () => repeatTap());
      const oSkip = opt('o-skip', 'rec-skip', t('recorder.skipSilence'), () => toggleSkip());
      const oSpeed = opt('o-speed', 'rec-speed', '1.0x', () => speedDialog());
      const playBtn = h('button', { class: 'rec-btn rec-playbtn', onClick: () => togglePlay() }, h('span', { class: 'rec-btn-in' }));
      const tBtn = (ic, label, fn) => h('button', { class: 'rec-tbtn', title: label, 'aria-label': label, html: icon(ic, 26), onClick: fn });
      const transport = h('div', { class: 'rec-transport', dir: 'ltr' }, tBtn('rec-rew', t('recorder.rew', { n: SKIP }), () => player.skip(-SKIP)), playBtn, tBtn('rec-ff', t('recorder.ff', { n: SKIP }), () => player.skip(SKIP)));
      body.appendChild(h('div', { class: 'rec-play' }, meta, stage, persons, textBox, times, h('div', { class: 'rec-opts' }, oMark, oRep, oSkip, oSpeed), transport));

      function drawStatic() {
        m = fresh(id);
        if (!m) return;
        page.setTitle(m.title);
        meta.replaceChildren(...[
          h('span', { class: ['rec-pmode', 'm-' + m.mode] }, h('span', { html: icon(MODE_ICON[m.mode], 16) }), modeName(m.mode)),
          h('span', null, dateText(m.at)),
          m.cat ? h('span', { class: 'rec-pcat' }, catName(m.cat)) : null,
        ].filter(Boolean));
        const split = m.mode === 'interview';
        stage.classList.toggle('split', split);
        persons.hidden = !(split && m.pk2);
        if (!persons.hidden)
          persons.replaceChildren(...[0, 1].map((i) => {
            const on = !player.muted(i);
            return h('button', { class: ['rec-pbtn', !on && 'off'], 'aria-pressed': String(on), onClick: () => { player.setMute(i, on); drawStatic(); } },
              h('span', { html: icon(on ? 'rec-person' : 'rec-person-off', 18) }), t('recorder.person', { n: i + 1 }));
          }));
        const txt = M.visibleText(m);
        textBox.hidden = !txt.length;
        lastSeg = -1;
        textBox.replaceChildren(...txt.map((p) => h('button', { class: 'rec-seg', onClick: () => player.seek(p.t) }, h('span', { class: 'rec-seg-t', dir: 'ltr' }, M.fmtLen(p.t)), h('span', { class: 'rec-seg-s', dir: 'auto' }, p.s))));
        oSkip.classList.toggle('on', !!m.skip);
        oSkip.setAttribute('aria-pressed', String(!!m.skip));
        oSpeed.querySelector('.rec-opt-lbl').textContent = `${(m.speed || 1).toFixed(1)}x`;
        oSpeed.classList.toggle('on', (m.speed || 1) !== 1);
        markTb.classList.toggle('active', M.visibleMarks(m).length > 0);
        paint();
      }
      function paint() {
        cancelAnimationFrame(raf);
        raf = 0;
        if (!m || !body.isConnected) return;
        const tm = player.memo?.id === m.id ? player.time() : 0, len = M.editLen(m);
        const [pk, pk2] = peaks(m);
        if (canvas.offsetWidth) drawScroll(canvas, { pk, pk2, split: m.mode === 'interview', pr: m.pr || 20, t: tm, len, marks: M.visibleMarks(m).map((b) => b.t), repeat: rep === 2 ? player.repeat : rep === 1 ? { a: repA, b: null } : null, label: rulerText, pxps: PXPS });
        cur.textContent = M.fmtClock(tm);
        tot.textContent = M.fmtLen(len);
        const on = player.playing() && player.memo?.id === m.id;
        if (playBtn.dataset.on !== String(on)) {
          playBtn.dataset.on = String(on);
          playBtn.querySelector('.rec-btn-in').innerHTML = icon(on ? 'pause' : 'play', 30);
          playBtn.title = on ? t('recorder.pause') : t('recorder.play');
          playBtn.setAttribute('aria-label', playBtn.title);
        }
        oRep.classList.toggle('on', rep > 0);
        oRep.querySelector('.rec-opt-lbl').textContent = rep === 1 ? t('recorder.repeatA') : rep === 2 ? t('recorder.repeatAB') : t('recorder.repeat');
        // the sentence being played
        if (!textBox.hidden) {
          const segs = textBox.children, txt = M.visibleText(m);
          let k = -1;
          for (let i = 0; i < txt.length; i++) if (txt[i].t <= tm + 0.05) k = i;
          if (k !== lastSeg) {
            segs[lastSeg]?.classList.remove('now');
            segs[k]?.classList.add('now');
            if (on) segs[k]?.scrollIntoView({ block: 'nearest' });
            lastSeg = k;
          }
        }
        if (on || drag) raf = requestAnimationFrame(paint);
      }

      // drag the waveform to scrub
      stage.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        try {
          stage.setPointerCapture(e.pointerId);
        } catch {}
        drag = { x: e.clientX, t: player.time(), was: player.playing() };
        player.pause();
        paint();
      });
      stage.addEventListener('pointermove', (e) => {
        if (!drag) return;
        player.seek(drag.t - (e.clientX - drag.x) / PXPS);
      });
      const up = () => {
        if (!drag) return;
        const was = drag.was;
        drag = null;
        if (was) player.play();
        paint();
      };
      stage.addEventListener('pointerup', up);
      stage.addEventListener('pointercancel', up);
      page.el.addEventListener('keydown', (e) => {
        if (e.target.closest('input, textarea')) return;
        if (e.key === ' ' || e.key === 'k') {
          e.preventDefault();
          togglePlay();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          player.skip(e.key === 'ArrowLeft' ? -SKIP : SKIP);
        }
      });

      const sub = () => paint();
      env.playerSubs.add(sub);
      const off = store.on(M.KEY, () => {
        const was = m;
        m = fresh(id);
        if (!m) return ctx.pop();
        if (player.memo?.id === id && (was.skip !== m.skip || was.speed !== m.speed || JSON.stringify(was.segs) !== JSON.stringify(m.segs) || was.dur !== m.dur)) player.refresh(m);
        drawStatic();
      });
      loadInto(player, m).then(() => drawStatic());
      drawStatic();
      const ro = new ResizeObserver(() => paint());
      ro.observe(stage);
      page.onReturn = () => {
        m = fresh(id);
        if (!m) return ctx.pop();
        loadInto(player, m).then(() => drawStatic());
      };
      return () => {
        cancelAnimationFrame(raf);
        env.playerSubs.delete(sub);
        off();
        ro.disconnect();
        player.setRepeat(null);
        player.pause();
      };
    },
  });

  function togglePlay() {
    if (E.active()) return toast(t('recorder.busy'));
    if (player.memo?.id !== id) return;
    player.toggle();
  }
  function addMark() {
    m = fresh(id);
    if (!m) return;
    const marks = m.marks || [];
    if (marks.length >= M.MAX_MARKS) return toast(t('recorder.marksFull', { n: M.MAX_MARKS }));
    const o = +M.toOrig(player.time(), M.segsOf(m)).toFixed(2);
    if (marks.some((b) => Math.abs(b.t - o) < 0.3)) return toast(t('recorder.markExists'), { duration: 1400 });
    patch(id, { marks: [...marks, { t: o }].sort((a, b) => a.t - b.t) });
    toast(t('recorder.markAdded'), { duration: 1400 });
  }
  // Repeat: first tap sets the start (A), the second the end (B) and loops, the third turns it off
  function repeatTap() {
    const tm = player.time();
    if (rep === 0) {
      rep = 1;
      repA = tm;
      toast(t('recorder.repeatSetB'), { duration: 1800 });
    } else if (rep === 1) {
      if (tm - repA < 0.5) return toast(t('recorder.repeatShort'), { duration: 1800 });
      rep = 2;
      player.setRepeat({ a: repA, b: tm });
      if (!player.playing()) player.play();
    } else {
      rep = 0;
      player.setRepeat(null);
    }
    env.playerSubs.forEach((fn) => fn());
  }
  function toggleSkip() {
    m = fresh(id);
    if (!m) return;
    patch(id, { skip: !m.skip });
    toast(!m.skip ? t('recorder.skipOn') : t('recorder.skipOff'), { duration: 1400 });
  }
  function speedDialog() {
    m = fresh(id);
    if (!m) return;
    let v = m.speed || 1;
    const val = h('div', { class: 'rec-speed-v', dir: 'ltr' }, `${v.toFixed(1)}x`);
    const set = (x) => {
      v = clamp(Math.round(x * 10) / 10, 0.5, 2);
      val.textContent = `${v.toFixed(1)}x`;
      s.set(v);
      patch(id, { speed: v === 1 ? undefined : v });
    };
    const s = slider({ min: 0.5, max: 2, step: 0.1, value: v, label: t('recorder.speed'), onInput: (x) => set(x) });
    const step = (d, ic, label) => h('button', { class: 'ou-icon-btn rec-speed-step', title: label, 'aria-label': label, html: icon(ic, 22), onClick: () => set(v + d) });
    dialog({
      title: t('recorder.speed'),
      className: 'rec-speed-dlg',
      content: h('div', { class: 'rec-speed' }, val, h('div', { class: 'rec-speed-row', dir: 'ltr' }, step(-0.1, 'minus', t('recorder.slower')), s, step(0.1, 'plus', t('recorder.faster')))),
      actions: [{ label: t('recorder.reset'), value: 'reset' }, { label: t('common.done'), value: true, primary: true }],
    }).then((r) => {
      if (r === 'reset') set(1);
    });
  }
  function marksDialog() {
    const box = h('div', { class: 'rec-marks' });
    const close = () => box.closest('.ou-dialog')?._close(null);
    const fill = () => {
      const x = fresh(id);
      const vm = x ? M.visibleMarks(x) : [];
      if (!vm.length) return box.replaceChildren(h('div', { class: 'rec-marks-empty' }, t('recorder.noMarks')));
      box.replaceChildren(...vm.map((b, k) =>
        h('div', { class: 'rec-mark' },
          h('button', { class: 'rec-mark-main', onClick: () => { player.seek(b.t); close(); } },
            h('span', { class: 'rec-mark-ico', html: icon('rec-flag', 18) }),
            h('span', { class: 'rec-mark-name', dir: 'auto' }, b.name || t('recorder.markN', { n: k + 1 })),
            h('span', { class: 'rec-mark-t', dir: 'ltr' }, M.fmtLen(b.t))),
          iconBtn('edit', async () => {
            const v = await prompt(t('recorder.markRename'), { value: b.name || t('recorder.markN', { n: k + 1 }) });
            if (v == null) return;
            const marks = [...(fresh(id)?.marks || [])];
            if (marks[b.i]) marks[b.i] = v.trim() ? { t: marks[b.i].t, name: v.trim().slice(0, 80) } : { t: marks[b.i].t };
            patch(id, { marks });
            fill();
          }, t('common.rename')),
          iconBtn('close', () => {
            const marks = (fresh(id)?.marks || []).filter((_, i) => i !== b.i);
            patch(id, { marks: marks.length ? marks : undefined });
            fill();
          }, t('common.delete')))));
    };
    fill();
    dialog({ title: t('recorder.bookmarks'), className: 'rec-marks-dlg', content: box, actions: [{ label: t('common.close'), value: null }] });
  }
  function moreMenu(at) {
    m = fresh(id);
    if (!m) return;
    menu(at, [
      { label: t('common.rename'), icon: 'edit', onClick: () => renameRec(m) },
      { label: t('recorder.edit'), icon: 'rec-trim', disabled: M.editLen(m) < 1 || !!E.active(), onClick: () => editPage(env, id) },
      canShare() ? { label: t('recorder.share'), icon: 'share', onClick: () => shareRec(m) } : null,
      { label: t('recorder.saveFile'), icon: 'download', onClick: () => saveFile(m) },
      { label: t('recorder.changeCat'), icon: 'rec-tag', onClick: () => changeCategory([id]) },
      m.text ? { label: t('recorder.copyText'), icon: 'copy', onClick: () => copyText(m) } : null,
      { label: t('recorder.details'), icon: 'info', onClick: () => details(m) },
      '-',
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: async () => { player.pause(); await trashRecs([id]); } },
    ], { align: 'end' });
  }
  return page;
}

// ------------------------------------------------------------------ edit (Trim / Delete)
export function editPage(env, id) {
  const { ctx, player } = env;
  let m = fresh(id);
  if (!m || m.rec) return null;
  player.pause();
  player.setRepeat(null);
  const peaks = peaksCache();
  let segs = M.segsOf(m).map((r) => [...r]), a = 0, b = M.lenOf(segs), changed = false, raf = 0;
  const saveBtn = h('button', { class: 'rec-tb-text strong', onClick: () => save() }, t('common.save'));
  let page;
  const preview = () => ({ ...m, segs, skip: false });
  page = ctx.push({
    title: t('recorder.edit'),
    hero: false,
    className: 'rec-page rec-edit-page',
    actions: [saveBtn],
    render(body, pg) {
      page = pg;
      body.classList.add('flush');
      const canvas = h('canvas', { class: 'rec-ewave' });
      const dimL = h('div', { class: 'rec-edim l' }), dimR = h('div', { class: 'rec-edim r' });
      const hL = h('button', { class: 'rec-eh l', 'aria-label': t('recorder.trimStart') }), hR = h('button', { class: 'rec-eh r', 'aria-label': t('recorder.trimEnd') });
      const selEl = h('div', { class: 'rec-esel' }, hL, hR);
      const ph = h('div', { class: 'rec-eph' });
      const stage = h('div', { class: 'rec-estage', dir: 'ltr' }, canvas, dimL, dimR, selEl, ph);
      const tA = h('span'), tB = h('span'), tLen = h('b');
      const clock = h('div', { class: 'rec-eclock', dir: 'ltr' });
      const playBtn = h('button', { class: 'rec-btn rec-playbtn small', onClick: () => playSel() }, h('span', { class: 'rec-btn-in' }));
      const pill = (cls, ic, label, fn) => h('button', { class: ['rec-epill', cls], onClick: fn }, h('span', { html: icon(ic, 20) }), h('span', null, label));
      const trimBtn = pill('trim', 'rec-trim', t('recorder.trim'), () => apply('trim'));
      const cutBtn = pill('cut', 'trash', t('common.delete'), () => apply('cut'));
      body.appendChild(h('div', { class: 'rec-edit' },
        h('div', { class: 'rec-ehint' }, t('recorder.editHint')),
        h('div', { class: 'rec-etimes', dir: 'ltr' }, tA, tLen, tB),
        stage,
        clock,
        h('div', { class: 'rec-etools' }, playBtn),
        h('div', { class: 'rec-ebtns' }, trimBtn, cutBtn)));

      function place() {
        const len = M.lenOf(segs) || 1, L = (a / len) * 100, R = (b / len) * 100;
        selEl.style.insetInlineStart = L + '%';
        selEl.style.width = R - L + '%';
        dimL.style.width = L + '%';
        dimR.style.width = 100 - R + '%';
        tA.textContent = M.fmtLen(a);
        tB.textContent = M.fmtLen(b);
        tLen.textContent = M.fmtLen(b - a);
        const whole = b - a >= len - 0.01;
        trimBtn.disabled = cutBtn.disabled = whole;
        saveBtn.disabled = !changed;
      }
      function paint() {
        cancelAnimationFrame(raf);
        raf = 0;
        if (!body.isConnected) return;
        const len = M.lenOf(segs), tm = player.memo?.id === id ? player.time() : 0;
        const [pk] = peaks(m, segs);
        if (canvas.offsetWidth) drawFit(canvas, { pk, len, t: null, gap: 3, sel: { a, b } });
        ph.style.insetInlineStart = (len ? (tm / len) * 100 : 0) + '%';
        clock.textContent = M.fmtClock(tm);
        const on = player.playing();
        if (on && tm >= b - 0.03) player.pause();
        if (playBtn.dataset.on !== String(on)) {
          playBtn.dataset.on = String(on);
          playBtn.querySelector('.rec-btn-in').innerHTML = icon(on ? 'pause' : 'play', 26);
          playBtn.title = on ? t('recorder.pause') : t('recorder.playSel');
          playBtn.setAttribute('aria-label', playBtn.title);
        }
        if (on) raf = requestAnimationFrame(paint);
      }
      function playSel() {
        if (player.playing()) return player.pause();
        const tm = player.time();
        if (tm < a || tm >= b - 0.05) player.seek(a);
        player.play();
      }
      function apply(kind) {
        const len = M.lenOf(segs);
        if (b - a >= len - 0.01) return;
        segs = kind === 'trim' ? M.keepSegs(segs, a, b) : M.cutSegs(segs, a, b);
        if (!segs.length || M.lenOf(segs) < 0.2) return;
        a = 0;
        b = M.lenOf(segs);
        changed = true;
        player.refresh(preview());
        player.seek(0);
        place();
        paint();
      }
      // the handles (and a click on the waveform moves the playhead)
      const timeAt = (x) => {
        const r = stage.getBoundingClientRect();
        return clamp((x - r.left) / r.width, 0, 1) * M.lenOf(segs);
      };
      const dragH = (which) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {}
        player.pause();
        const move = (ev) => {
          const v = timeAt(ev.clientX), min = 0.5;
          if (which === 'a') a = clamp(v, 0, b - min);
          else b = clamp(v, a + min, M.lenOf(segs));
          player.seek(which === 'a' ? a : Math.max(a, b - 1));
          place();
          paint();
        };
        const done = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', done);
          el.removeEventListener('pointercancel', done);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', done);
        el.addEventListener('pointercancel', done);
      };
      hL.addEventListener('pointerdown', dragH('a'));
      hR.addEventListener('pointerdown', dragH('b'));
      const keyH = (which) => (e) => {
        const d = { ArrowLeft: -0.5, ArrowRight: 0.5 }[e.key];
        if (d == null) return;
        e.preventDefault();
        if (which === 'a') a = clamp(a + d, 0, b - 0.5);
        else b = clamp(b + d, a + 0.5, M.lenOf(segs));
        place();
        paint();
      };
      hL.addEventListener('keydown', keyH('a'));
      hR.addEventListener('keydown', keyH('b'));
      stage.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.rec-eh')) return;
        player.seek(timeAt(e.clientX));
        paint();
      });

      const sub = () => paint();
      env.playerSubs.add(sub);
      loadInto(player, m).then(() => {
        player.refresh(preview());
        player.seek(0);
        paint();
      });
      place();
      paint();
      const ro = new ResizeObserver(() => paint());
      ro.observe(stage);
      return () => {
        cancelAnimationFrame(raf);
        env.playerSubs.delete(sub);
        ro.disconnect();
        player.pause();
        const x = fresh(id);
        if (x && player.memo?.id === id) player.refresh(x);
      };
    },
  });

  async function save() {
    if (!changed) return ctx.pop();
    player.pause();
    const how = await dialog({
      title: t('recorder.saveEdit'),
      message: t('recorder.saveEditMsg'),
      actions: [{ label: t('common.cancel'), value: null }, { label: t('recorder.saveNew'), value: 'new' }, { label: t('recorder.replace'), value: 'replace', primary: true }],
    });
    if (!how) return;
    m = fresh(id);
    if (!m) return ctx.pop();
    const tidy = M.tidySegs(segs, m.dur);
    if (how === 'replace') {
      patch(id, { segs: tidy });
      toast(t('recorder.saved'));
      ctx.pop();
      return;
    }
    const base = m.title.replace(/_\d{2}$/, '');
    let n = 1;
    const names = new Set(D().items.map((x) => x.title));
    while (names.has(`${base}_${String(n).padStart(2, '0')}`)) n++;
    const nid = await duplicate(m, { segs: tidy, title: `${base}_${String(n).padStart(2, '0')}`, speed: undefined, skip: undefined });
    if (!nid) return;
    toast(t('recorder.savedAs', { name: byId(nid)?.title || '' }));
    ctx.pop();
    ctx.pop();
    setTimeout(() => playPage(env, nid), 60);
  }
  return page;
}

