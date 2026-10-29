// Samsung Music full player: big album art over a backdrop made from the cover, title/artist with Favourite,
// seek bar, shuffle · previous · play · next · repeat, volume, and a tool row for Lyrics, Sleep timer, Equaliser
// and the playing queue. It slides up over the app window from the mini player.
import { h, escapeHtml, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { store } from '../core/store.js';
import { toast } from '../core/ui.js';
import { fmtDur, parseLyrics, plainLyrics, lineAt, sleepLeft } from './core.js';
import { lib, fav, artHTML, hydrateArt, getLyrics, artistOf, cachedArt, artUrl } from './library.js';
import { music, fromLabel } from './player.js';
import { sleepDialog, editLyrics, openEqualizer } from './sheets.js';

const esc = escapeHtml;
const ic = (n, s = 22) => icon(n, s);

/** A One UI thin slider (seek bar / volume): value 0..1, drag, click and arrow keys. */
function thinSlider({ label, onInput, onCommit, step = 0.02 }) {
  const fill = h('i', { class: 'mu-sl-fill' });
  const knob = h('b', { class: 'mu-sl-knob' });
  const el = h('div', { class: 'mu-sl', role: 'slider', tabindex: 0, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { class: 'mu-sl-track' }, fill, knob));
  let v = 0, dragging = false;
  const rtl = () => getComputedStyle(el).direction === 'rtl';
  const show = (x) => {
    v = clamp(x, 0, 1);
    fill.style.width = v * 100 + '%';
    knob.style.insetInlineStart = v * 100 + '%';
    el.setAttribute('aria-valuenow', Math.round(v * 100));
  };
  const at = (e) => {
    const r = el.getBoundingClientRect();
    const p = (e.clientX - r.left) / r.width;
    return rtl() ? 1 - p : p;
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    dragging = true;
    el.classList.add('dragging');
    show(at(e));
    onInput?.(v);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    show(at(e));
    onInput?.(v);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    onCommit?.(v);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }[e.key];
    if (d == null) return;
    e.preventDefault();
    e.stopPropagation();
    show(v + (rtl() && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') ? -d : d));
    onCommit?.(v);
  });
  el.set = (x) => !dragging && show(x);
  el.isDragging = () => dragging;
  return el;
}

export function openFull({ stack, ctx, go, trackMenu }) {
  let open = false, pane = '', key = '', lyrics = null, lyricsFor = null, activeLine = -1, userScroll = 0, timer = null;
  const off = [];

  const bgImg = h('div', { class: 'mu-f-bgimg' });
  const closeBtn = h('button', { class: 'ou-icon-btn mu-f-close', 'aria-label': t('common.close'), html: ic('down', 26), onClick: () => close() });
  const fromEl = h('div', { class: 'mu-f-from' });
  const moreBtn = h('button', { class: 'ou-icon-btn', 'aria-label': t('common.more'), html: ic('more'), onClick: (e) => {
    const id = music.current();
    if (id) trackMenu(e.currentTarget, [id], { fromFull: true });
  } });
  const art = h('div', { class: 'mu-f-art', role: 'button', tabindex: 0, 'aria-label': t('music.lyrics') });
  const lyr = h('div', { class: 'mu-f-lyrics scroll' });
  const que = h('div', { class: 'mu-f-queue' });
  const stage = h('div', { class: 'mu-f-stage' }, art, lyr, que);
  const title = h('div', { class: 'mu-f-title' });
  const artist = h('button', { class: 'mu-f-artist', onClick: () => {
    const x = lib.get(music.current());
    const ar = x && lib.artistOfTrack(x);
    if (ar) go('artist', ar.id);
  } });
  const favBtn = h('button', { class: 'ou-icon-btn mu-f-fav', 'aria-label': t('music.favourite'), onClick: () => {
    const id = music.current();
    if (!id) return;
    const on = fav.toggle(id);
    toast(on ? t('music.addedFav') : t('music.removedFav'));
    drawFav();
  } });
  const elapsed = h('span'), total = h('span');
  const seek = thinSlider({
    label: t('music.position'),
    onInput: (v) => (elapsed.textContent = fmtDur(v * music.dur())),
    onCommit: (v) => music.seek(v * music.dur()),
  });
  const btn = (name, cls, label, fn) => h('button', { class: ['ou-icon-btn', cls], 'aria-label': label, dataset: { c: name }, onClick: fn });
  const shuf = btn('shuffle', 'mu-f-mode', t('music.shuffle'), () => music.setShuffle(!music.get().shuffle));
  const rep = btn('repeat', 'mu-f-mode', t('music.repeat'), () => music.cycleRepeat());
  const pp = btn('toggle', 'mu-f-pp', t('music.play'), () => music.toggle());
  const ctrls = h('div', { class: 'mu-f-ctrls' },
    shuf,
    btn('prev', 'mu-f-skip', t('music.prev'), () => music.prev()),
    pp,
    btn('next', 'mu-f-skip', t('music.next'), () => music.next()),
    rep);
  shuf.innerHTML = ic('shuffle');
  ctrls.querySelector('[data-c=prev]').innerHTML = ic('prev', 30);
  ctrls.querySelector('[data-c=next]').innerHTML = ic('next', 30);
  const vol = thinSlider({ label: t('music.volume'), step: 0.05, onInput: (v) => music.volume(v), onCommit: (v) => music.volume(v) });
  const tool = (name, label, fn) => h('button', { class: 'mu-f-tool', 'aria-label': label, title: label, dataset: { tool: name }, onClick: fn }, h('span', { html: ic(name === 'sleep' ? 'sleep' : name) }), h('small'));
  const tools = h('div', { class: 'mu-f-tools' },
    tool('lyrics', t('music.lyrics'), () => setPane('lyrics')),
    tool('sleep', t('music.sleepTimer'), () => sleepDialog()),
    tool('eq', t('music.equaliser'), () => openEqualizer()),
    tool('queue', t('music.queue'), () => setPane('queue')));
  const el = h('div', { class: 'mu-full', hidden: true, role: 'dialog', 'aria-label': t('music.nowPlaying') },
    h('div', { class: 'mu-f-bg' }, bgImg),
    h('div', { class: 'mu-f-top' }, closeBtn, fromEl, moreBtn),
    h('div', { class: 'mu-f-main' },
      stage,
      h('div', { class: 'mu-f-side' },
        h('div', { class: 'mu-f-info' }, h('div', { class: 'mu-f-titles' }, title, artist), favBtn),
        h('div', { class: 'mu-f-seek' }, seek, h('div', { class: 'mu-f-times' }, elapsed, total)),
        ctrls,
        h('div', { class: 'mu-f-vol' }, h('span', { html: ic('volLow', 18) }), vol, h('span', { html: ic('volume', 18) })),
        tools)));
  stack.append(el);
  art.addEventListener('click', () => setPane('lyrics'));

  // ——— drawing ———
  function draw() {
    if (!open) return;
    const m = music.get(), n = m.now;
    if (!m.queue.length || !n) return close();
    const k = [n.id, n.title, n.artist, n.album, n.art].join('|');
    el.classList.toggle('playing', m.playing);
    el.style.setProperty('--fc', n.color || 'var(--accent)');
    pp.innerHTML = ic(m.playing ? 'pause' : 'play', 34);
    pp.setAttribute('aria-label', m.playing ? t('music.pause') : t('music.play'));
    shuf.classList.toggle('on', m.shuffle);
    shuf.setAttribute('aria-pressed', String(m.shuffle));
    rep.classList.toggle('on', m.repeat !== 'off');
    rep.innerHTML = ic(m.repeat === 'one' ? 'repeatOne' : 'repeat');
    rep.setAttribute('aria-label', t('music.repeat.' + m.repeat));
    rep.title = t('music.repeat.' + m.repeat);
    vol.set(m.volume);
    const from = fromLabel(m.from);
    fromEl.textContent = from ? t('music.playingFrom', { name: from }) : '';
    const left = sleepLeft(m);
    const sl = tools.querySelector('[data-tool=sleep]');
    sl.classList.toggle('on', !!(left || m.sleepEnd));
    sl.querySelector('small').textContent = left ? t('music.minShort', { n: left }) : '';
    tools.querySelector('[data-tool=eq]').classList.toggle('on', m.eq !== 'normal');
    if (k !== key) {
      key = k;
      art.innerHTML = artHTML(n.art, 'mu-f-img');
      hydrateArt(art);
      title.textContent = n.title;
      artist.textContent = n.artist || t('music.unknownArtist');
      const u = n.art && cachedArt(n.art);
      bgImg.style.backgroundImage = u ? `url("${u}")` : '';
      if (n.art && !u) artUrl(n.art).then((x) => x && key === k && (bgImg.style.backgroundImage = `url("${x}")`));
      el.classList.toggle('no-art', !n.art);
      activeLine = -1;
      if (pane === 'lyrics') drawLyrics();
    }
    if (pane === 'queue') drawQueue();
    drawFav();
    tick();
  }
  function drawFav() {
    const on = fav.has(music.current());
    favBtn.innerHTML = ic(on ? 'heartFill' : 'heart');
    favBtn.classList.toggle('on', on);
    favBtn.setAttribute('aria-pressed', String(on));
  }
  function tick() {
    const d = music.dur(), p = music.pos();
    if (!seek.isDragging()) {
      seek.set(d ? p / d : 0);
      elapsed.textContent = fmtDur(p);
    }
    total.textContent = fmtDur(d);
    if (pane === 'lyrics' && lyrics?.synced) syncLyrics(p);
  }

  // ——— panes ———
  function setPane(p) {
    pane = pane === p ? '' : p;
    el.dataset.pane = pane;
    tools.querySelectorAll('[data-tool=lyrics], [data-tool=queue]').forEach((b) => b.classList.toggle('on', b.dataset.tool === pane));
    if (pane === 'lyrics') drawLyrics();
    else if (pane === 'queue') drawQueue(true);
  }

  async function drawLyrics() {
    const id = music.current();
    const x = lib.get(id);
    if (lyricsFor !== id) {
      lyricsFor = id;
      lyrics = null;
      lyr.replaceChildren();
      const text = x?.lrc ? await getLyrics(id) : null;
      if (lyricsFor !== id) return;
      const lines = parseLyrics(text);
      lyrics = lines ? { synced: true, lines } : text ? { synced: false, text: plainLyrics(text) } : { none: true };
    }
    if (lyrics.none) {
      lyr.replaceChildren(h('div', { class: 'mu-f-nolyr' }, h('span', { html: ic('lyrics', 40) }), h('b', null, t('music.noLyrics')),
        x ? h('button', { class: 'ou-btn', onClick: () => editLyrics(id, () => { lyricsFor = null; drawLyrics(); }) }, t('music.addLyrics')) : null));
      return;
    }
    if (!lyrics.synced) {
      lyr.replaceChildren(h('div', { class: 'mu-f-plain', dir: 'auto' }, lyrics.text));
      return;
    }
    lyr.innerHTML = `<div class="mu-f-lines" dir="auto">${lyrics.lines.map((l, i) => `<p data-i="${i}">${esc(l.text) || '♪'}</p>`).join('')}</div>`;
    activeLine = -1;
    syncLyrics(music.pos(), true);
  }
  lyr.addEventListener('click', (e) => {
    const p = e.target.closest('p[data-i]');
    if (p && lyrics?.synced) music.seek(lyrics.lines[+p.dataset.i].t);
  });
  lyr.addEventListener('wheel', () => (userScroll = Date.now()), { passive: true });
  function syncLyrics(pos, jump) {
    const i = lineAt(lyrics.lines, pos);
    if (i === activeLine && !jump) return;
    activeLine = i;
    lyr.querySelectorAll('p.on').forEach((p) => p.classList.remove('on'));
    const p = lyr.querySelector(`p[data-i="${i}"]`);
    if (!p) return;
    p.classList.add('on');
    if (Date.now() - userScroll > 4000) lyr.scrollTo({ top: p.offsetTop - lyr.clientHeight * 0.4, behavior: jump ? 'auto' : 'smooth' });
  }

  let queueKey = '';
  function drawQueue(force) {
    const m = music.get();
    const k = m.queue.join(',') + '|' + m.index;
    if (k === queueKey && !force) return;
    queueKey = k;
    const rows = m.queue.map((id, i) => {
      const x = lib.get(id);
      if (!x) return '';
      return `<div class="mu-qrow${i === m.index ? ' current' : ''}${i < m.index ? ' past' : ''}" data-q="${i}" tabindex="0" role="button">
        <span class="mu-lead">${artHTML(x.art, 'mu-thumb')}<span class="mu-bars"><i></i><i></i><i></i></span></span>
        <span class="mu-tt"><span class="mu-t1">${esc(x.title)}</span><span class="mu-t2">${esc(artistOf(x))}</span></span>
        ${i === m.index ? '' : `<button class="ou-icon-btn mu-qx" data-qx="${i}" aria-label="${esc(t('music.remove'))}">${ic('close', 18)}</button>`}
        <span class="mu-qdrag" data-qd="${i}" aria-hidden="true">${ic('drag', 20)}</span></div>`;
    }).join('');
    que.innerHTML = `<div class="mu-qhead"><b>${esc(t('music.queue'))}</b><span>${esc(t('music.queuePos', { i: m.index + 1, n: m.queue.length }))}</span></div><div class="mu-qlist scroll">${rows}</div>`;
    hydrateArt(que);
    const cur = que.querySelector('.mu-qrow.current');
    if (cur && force) cur.parentElement.scrollTop = cur.offsetTop - 80;
  }
  que.addEventListener('click', (e) => {
    const x = e.target.closest('[data-qx]');
    if (x) {
      e.stopPropagation();
      return music.remove(+x.dataset.qx);
    }
    const r = e.target.closest('[data-q]');
    if (r && !e.target.closest('[data-qd]')) music.jump(+r.dataset.q);
  });
  // drag a row by its handle to reorder the queue
  que.addEventListener('pointerdown', (e) => {
    const hnd = e.target.closest('[data-qd]');
    if (!hnd || e.button !== 0) return;
    e.preventDefault();
    const row = hnd.closest('.mu-qrow'), list = row.parentElement;
    const from = +hnd.dataset.qd, rh = row.offsetHeight, y0 = e.clientY, n = list.children.length;
    let to = from;
    row.classList.add('dragging');
    hnd.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dy = ev.clientY - y0;
      row.style.transform = `translateY(${dy}px)`;
      to = clamp(from + Math.round(dy / rh), 0, n - 1);
    };
    const up = () => {
      hnd.removeEventListener('pointermove', move);
      hnd.removeEventListener('pointerup', up);
      hnd.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      row.style.transform = '';
      if (to !== from) music.move(from, to);
    };
    hnd.addEventListener('pointermove', move);
    hnd.addEventListener('pointerup', up);
    hnd.addEventListener('pointercancel', up);
  });

  // ——— open / close ———
  const onKey = (e) => {
    if (!open || e.defaultPrevented || (ctx && !ctx.focused) || document.querySelector('.ou-dialog-scrim, .ou-menu-scrim')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (pane) setPane(pane);
      else close();
    } else if (!e.target.closest('input, textarea, [contenteditable], [role=slider]')) {
      if (e.key === 'ArrowRight' && e.altKey) music.next();
      else if (e.key === 'ArrowLeft' && e.altKey) music.prev();
    }
  };
  function openIt() {
    if (open || !music.get().queue.length) return;
    open = true;
    key = '';
    el.hidden = false;
    stack.classList.add('mu-full-open');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    addEventListener('keydown', onKey, true);
    off.push(store.on('music', draw), store.on('musicPos', tick), store.on('musicLib', drawFav), lib.onChange(() => {
      key = '';
      lyricsFor = null;
      draw();
    }));
    timer = setInterval(tick, 500);
    draw();
    setTimeout(() => pp.focus({ preventScroll: true }), 80);
  }
  function close() {
    if (!open) return;
    open = false;
    el.classList.remove('show');
    stack.classList.remove('mu-full-open');
    removeEventListener('keydown', onKey, true);
    off.splice(0).forEach((f) => f());
    clearInterval(timer);
    setTimeout(() => !open && (el.hidden = true), 320);
  }
  return {
    open: openIt,
    close,
    isOpen: () => open,
    destroy() {
      close();
      el.remove();
    },
  };
}
