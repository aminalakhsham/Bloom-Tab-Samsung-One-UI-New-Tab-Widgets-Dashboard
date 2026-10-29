// Samsung Music dialogs and settings: Add to playlist, Details and Edit tags, lyrics, Sleep timer, Settings
// (Sound quality and effects › Equaliser, Crossfade, Play speed, library storage).
import { h, escapeHtml, clamp, pickFile } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtTime, fmtDate } from '../core/i18n.js';
import { store } from '../core/store.js';
import { dialog, toast, prompt, choose, confirm, list, row, subheader, card } from '../core/ui.js';
import { fmtDur, EQ_BANDS, EQ_IDS, eqGains, sleepLeft } from './core.js';
import { lib, playlists, fav, plays, artHTML, hydrateArt, editTracks, getLyrics, setLyrics, deleteAll, artistOf } from './library.js';
import { music } from './player.js';

const esc = escapeHtml;
// numbers with Latin units stay in one piece inside Arabic text (LTR isolate)
const iso = (s) => '\u2066' + s + '\u2069';
const fmtBytes = (n) => iso(n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(0, Math.round((n || 0) / 1e3)) + ' KB');
const fmtSpeed = (n) => iso(n.toFixed(2).replace(/0$/, '') + '×');
const songs = (n) => (n === 1 ? t('music.oneTrack') : t('music.nTracks', { n }));

// ——— Add to playlist ———
export function addToPlaylist(ids, after) {
  const all = playlists.all();
  const box = h('div', { class: 'mu-plpick' });
  const pick = (fn) => () => {
    fn();
    box.closest('.ou-dialog')?._close(true);
    after?.();
  };
  box.append(
    h('button', { class: 'mu-plp-row accent', onClick: async () => {
      box.closest('.ou-dialog')?._close(null);
      const name = await prompt(t('music.createPlaylist'), { placeholder: t('music.playlistName'), okLabel: t('music.create') });
      if (!name?.trim()) return;
      playlists.create(name.trim(), ids);
      toast(t('music.addedToPl', { name: name.trim() }));
      after?.();
    } }, h('span', { class: 'mu-art mu-newpl', html: icon('plus', 22) }), h('span', null, t('music.createPlaylist'))),
    h('button', { class: 'mu-plp-row', onClick: pick(() => {
      fav.add(ids);
      toast(t('music.addedFav'));
    }) }, h('span', { class: 'mu-art mu-smart', style: { '--sc': '#f2556b' }, html: icon('heartFill', 22) }), h('span', null, t('music.favTracks'))),
    ...all.map((p) => h('button', { class: 'mu-plp-row', onClick: pick(() => {
      const n = playlists.add(p.id, ids);
      toast(n ? t('music.addedToPl', { name: p.name }) : t('music.alreadyInPl'));
    }) }, h('span', { html: artHTML(playlists.songs(p).find((x) => x.art)?.art) }), h('span', null, h('span', null, p.name), h('small', null, songs(playlists.songs(p).length))))));
  hydrateArt(box);
  return dialog({ title: t('music.addToPlaylist'), content: box, actions: [{ label: t('common.cancel'), value: null }] });
}

// ——— Details / Edit tags ———
export function showDetails(id) {
  const x = lib.get(id);
  if (!x) return;
  const ext = (x.name?.match(/\.([a-z0-9]+)$/i)?.[1] || x.type?.split('/')[1] || '').toUpperCase();
  const rows = [
    [t('music.f.title'), x.title], [t('music.f.artist'), artistOf(x)], [t('music.f.album'), x.album || t('music.unknownAlbum')],
    [t('music.f.albumArtist'), x.albumArtist], [t('music.f.genre'), x.genre], [t('music.f.track'), x.track || ''], [t('music.f.disc'), x.disc || ''],
    [t('music.f.year'), x.year || ''], [t('music.f.length'), fmtDur(x.dur)], [t('music.f.format'), ext], [t('music.f.size'), fmtBytes(x.size)],
    [t('music.f.location'), [x.dir, x.name].filter(Boolean).join('/')], [t('music.f.added'), fmtDate(new Date(x.addedAt), { year: 'numeric', month: 'short', day: 'numeric' })],
    [t('music.f.plays'), String(plays(x.id))],
  ].filter((r) => r[1] !== '' && r[1] != null);
  const box = h('div', { class: 'mu-details' },
    h('div', { class: 'mu-det-head', html: `${artHTML(x.art, 'mu-det-art')}<div><b>${esc(x.title)}</b><small>${esc(artistOf(x))}</small></div>` }),
    h('dl', null, rows.map(([k, v]) => [h('dt', null, k), h('dd', { dir: 'auto' }, String(v))])));
  hydrateArt(box);
  dialog({ title: t('music.details'), content: box, className: 'mu-dialog', actions: [
    { label: t('music.editTags'), value: 'edit' },
    { label: t('common.ok'), value: null, primary: true },
  ] }).then((v) => v === 'edit' && editTags(id));
}

export function editTags(id) {
  const x = lib.get(id);
  if (!x) return;
  const fields = [['title', 'f.title'], ['artist', 'f.artist'], ['album', 'f.album'], ['albumArtist', 'f.albumArtist'], ['genre', 'f.genre'], ['track', 'f.track', 'num'], ['disc', 'f.disc', 'num'], ['year', 'f.year', 'num']];
  let newArt = null;
  const artBox = h('span', { class: 'mu-et-art', html: artHTML(x.art) });
  const inputs = {};
  const box = h('div', { class: 'mu-edittags' },
    h('div', { class: 'mu-et-top' }, artBox, h('button', { class: 'ou-btn tonal', onClick: async () => {
      const f = await pickFile('image/*');
      if (!f) return;
      newArt = f;
      artBox.innerHTML = `<img class="mu-art" alt="" src="${URL.createObjectURL(f)}">`;
    } }, t('music.changeArt'))),
    fields.map(([k, label, type]) => {
      inputs[k] = h('input', { class: 'ou-input', dir: 'auto', name: k, inputmode: type === 'num' ? 'numeric' : null, value: x[k] ? String(x[k]) : '' });
      return h('label', { class: 'mu-field' }, h('span', null, t('music.' + label)), inputs[k]);
    }));
  hydrateArt(box);
  dialog({ title: t('music.editTags'), content: box, className: 'mu-dialog', actions: [
    { label: t('common.cancel'), value: null },
    { label: t('common.save'), primary: true, value: () => {
      const patch = {};
      for (const [k, , type] of fields) {
        const v = inputs[k].value.trim();
        patch[k] = type === 'num' ? Math.max(0, parseInt(v, 10) || 0) : v;
      }
      if (!patch.title) patch.title = x.title;
      if (newArt) patch.art = newArt;
      return patch;
    } },
  ] }).then(async (patch) => {
    if (!patch) return;
    await editTracks([id], patch);
    music.sync();
    toast(t('music.saved'));
  });
}

// ——— lyrics ———
export async function editLyrics(id, after) {
  const x = lib.get(id);
  if (!x) return;
  const ta = h('textarea', { class: 'ou-input mu-lyr-edit', rows: 10, dir: 'auto', placeholder: t('music.lyricsPh') });
  ta.value = (x.lrc ? await getLyrics(id) : '') || '';
  const box = h('div', { class: 'mu-lyrbox' }, ta, h('button', { class: 'ou-btn tonal', onClick: async () => {
    const f = await pickFile('.lrc,.txt,text/plain');
    if (f) ta.value = await f.text();
  } }, h('span', { html: icon('upload', 18) }), t('music.importLrc')));
  const v = await dialog({ title: x.lrc ? t('music.editLyrics') : t('music.addLyrics'), content: box, className: 'mu-dialog', actions: [
    { label: t('common.cancel'), value: null },
    { label: t('common.save'), primary: true, value: () => ta.value },
  ] });
  if (v == null) return;
  await setLyrics(id, v);
  toast(t('music.saved'));
  after?.();
}

// ——— sleep timer ———
export async function sleepDialog() {
  const m = music.get();
  const cur = m.sleepEnd ? 'end' : sleepLeft(m) ? 'on' : 0;
  const opts = [
    { value: 0, label: t('music.sleepOff') },
    ...[15, 30, 60, 90, 120].map((n) => ({ value: n, label: n < 60 ? t('music.min', { n }) : n % 60 ? t('music.hrMin', { h: Math.floor(n / 60), m: n % 60 }) : n === 60 ? t('music.oneHour') : t('music.hours', { n: n / 60 }) })),
    { value: 'end', label: t('music.sleepEnd') },
    { value: 'custom', label: t('music.custom'), sub: cur === 'on' ? t('music.sleepStops', { time: fmtTime(new Date(m.sleepAt)) }) : '' },
  ];
  let v = await choose(t('music.sleepTimer'), opts, cur === 'on' ? 'custom' : cur);
  if (v == null) return;
  if (v === 'custom') {
    const s = await prompt(t('music.sleepCustom'), { type: 'number', value: String(sleepLeft(m) || 45), placeholder: t('music.minutes') });
    v = clamp(parseInt(s, 10) || 0, 0, 24 * 60);
    if (!s) return;
  }
  music.sleep(v);
  if (v === 'end') toast(t('music.sleepEndSet'));
  else if (v) toast(t('music.sleepSet', { time: fmtTime(new Date(Date.now() + v * 60000)) }));
  else toast(t('music.sleepOffToast'));
}

// ——— equaliser ———
/** One UI Equaliser: preset chips and nine vertical band sliders (dragging a band switches to Custom). */
export function eqPanel() {
  const chips = h('div', { class: 'ou-chips mu-eq-presets' });
  const bands = h('div', { class: 'mu-eq-bands' });
  const hz = (f) => (f >= 1000 ? f / 1000 + 'k' : String(f));
  const cols = EQ_BANDS.map((f, i) => {
    const knob = h('b', { class: 'mu-eq-knob' }), fill = h('i', { class: 'mu-eq-fill' }), db = h('span', { class: 'mu-eq-db' });
    const track = h('div', { class: 'mu-eq-track', role: 'slider', tabindex: 0, 'aria-label': hz(f) + ' Hz', 'aria-valuemin': -10, 'aria-valuemax': 10 }, fill, knob);
    const col = h('div', { class: 'mu-eq-col' }, db, track, h('span', { class: 'mu-eq-hz' }, hz(f)));
    const set = (v) => {
      const m = music.get();
      const g = eqGains(m).slice();
      g[i] = clamp(Math.round(v), -10, 10);
      music.setEq('custom', g);
    };
    const fromY = (e) => {
      const r = track.getBoundingClientRect();
      return (1 - (e.clientY - r.top) / r.height) * 20 - 10;
    };
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      set(fromY(e));
      const move = (ev) => set(fromY(ev));
      const up = () => {
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
    });
    track.addEventListener('keydown', (e) => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (d == null) return;
      e.preventDefault();
      set(eqGains(music.get())[i] + d);
    });
    col._draw = (v) => {
      const p = (v + 10) / 20;
      knob.style.bottom = `calc(${p * 100}% - 9px)`;
      fill.style.bottom = v >= 0 ? '50%' : p * 100 + '%';
      fill.style.height = Math.abs(v) * 2.5 + '%';
      db.textContent = (v > 0 ? '+' : '') + v;
      track.setAttribute('aria-valuenow', v);
    };
    return col;
  });
  bands.append(...cols);
  const draw = () => {
    const m = music.get();
    chips.replaceChildren(...EQ_IDS.map((id) => h('button', { class: ['ou-chip', m.eq === id && 'active'], dataset: { eq: id }, onClick: () => (id === 'custom' ? music.setEq('custom', eqGains(m)) : music.setEq(id)) }, t('music.eq.' + id))));
    const g = eqGains(m);
    cols.forEach((c, i) => c._draw(g[i]));
    el.classList.toggle('custom', m.eq === 'custom');
  };
  const el = h('div', { class: 'mu-eq' }, chips, h('div', { class: 'mu-eq-card' }, h('div', { class: 'mu-eq-scale' }, h('span', null, '+10'), h('span', null, '0'), h('span', null, '-10')), bands),
    h('div', { class: 'mu-eq-note' }, t('music.eqNote')));
  draw();
  const off = store.on('music', draw);
  el._off = off;
  return el;
}

/** The equaliser as a dialog (from the full player). */
export function openEqualizer() {
  const panel = eqPanel();
  dialog({ title: t('music.equaliser'), content: panel, className: 'wide mu-dialog mu-eq-dialog', actions: [{ label: t('common.done'), value: true, primary: true }] }).then(() => panel._off());
}

// ——— settings ———
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const XF = [0, 2, 4, 6, 8, 10, 12];

export function openSettings(push, { addMenu }) {
  push({
    title: t('music.settings'),
    hero: true,
    className: 'mu-settings',
    render(body) {
      const draw = () => {
        const m = music.get();
        const left = sleepLeft(m);
        const size = lib.size();
        body.replaceChildren(
          list(row({ icon: 'eq', title: t('music.soundQuality'), sub: t('music.equaliser') + ' · ' + t('music.eq.' + m.eq), chevron: true, onClick: () => openEqPage(push) })),
          subheader(t('music.playback')),
          list(
            row({ icon: 'crossfade', title: t('music.crossfade'), sub: m.crossfade ? t('music.seconds', { n: m.crossfade }) : t('music.off'), onClick: async () => {
              const v = await choose(t('music.crossfade'), XF.map((n) => ({ value: n, label: n ? t('music.seconds', { n }) : t('music.off') })), m.crossfade);
              if (v != null) music.setCrossfade(v);
            } }),
            row({ icon: 'speed', title: t('music.speed'), sub: fmtSpeed(m.speed), onClick: async () => {
              const v = await choose(t('music.speed'), SPEEDS.map((n) => ({ value: n, label: fmtSpeed(n) + (n === 1 ? ' · ' + t('music.normal') : '') })), m.speed);
              if (v != null) music.setSpeed(v);
            } }),
            row({ icon: 'sleep', title: t('music.sleepTimer'), sub: m.sleepEnd ? t('music.sleepEnd') : left ? t('music.sleepStops', { time: fmtTime(new Date(m.sleepAt)) }) : t('music.off'), onClick: () => sleepDialog() })),
          subheader(t('music.library')),
          list(
            row({ icon: 'musicAdd', title: t('music.addMusic'), sub: t('music.addMusicSub'), className: 'muted-sub', onClick: (e) => addMenu(e.currentTarget) }),
            row({ icon: 'folder', title: t('music.storage'), sub: songs(lib.tracks().length) + ' · ' + fmtBytes(size), className: 'muted-sub' }),
            row({ icon: 'trash', title: t('music.deleteAll'), sub: t('music.deleteAllSub'), className: 'muted-sub mu-danger', onClick: async () => {
              if (!lib.tracks().length) return;
              if (!(await confirm(t('music.deleteAllQ'), t('music.deleteAllMsg'), { okLabel: t('common.delete'), danger: true }))) return;
              await deleteAll();
              music.sync();
              toast(t('music.deleted'));
            } })),
          card(h('div', { class: 'mu-about' }, h('span', { html: icon('lock', 18) }), h('span', null, t('music.privacy')))));
      };
      draw();
      const offs = [store.on('music', draw), lib.onChange(draw)];
      return () => offs.forEach((f) => f());
    },
  }, { mini: false });
}

function openEqPage(push) {
  push({
    title: t('music.equaliser'),
    hero: true,
    className: 'mu-eqpage',
    render(body) {
      const panel = eqPanel();
      body.append(h('div', { class: 'ou-card' }, panel));
      return () => panel._off();
    },
  }, { mini: false });
}
