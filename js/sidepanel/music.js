// Side panel › Music: Samsung Music's now-playing controls (the source js/apps/music.js registers for the Quick Panel's
// media card: title, artist, cover, previous / play-pause / next, played by the service worker's offscreen player, so it
// keeps going whatever the panel does) and the ambient sounds of js/shell/sounds.js, which play from the panel itself.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { slider } from '../core/ui.js';
import { activeMedia, onMediaChange } from '../core/hooks.js';
import * as sounds from '../shell/sounds.js';
import { header, openAppBtn, openInBloom } from './kit.js';

export async function render(main) {
  await import('../apps/music.js').catch((e) => console.warn('side panel music', e)); // registers the media source
  const card = h('div', { class: 'sp-card sp-np' });
  const grid = h('div', { class: 'sp-sounds' });
  const vol = slider({ value: Math.round(sounds.state().volume * 100), icon: 'volume', label: t('sp.music.volume'), onInput: (v) => sounds.setVolume(v / 100) });
  vol.classList.add('sp-vol');
  main.replaceChildren(
    header({ title: t('sp.tab.music'), actions: [openAppBtn('music')] }),
    card,
    h('div', { class: 'ou-subheader sp-subheader' }, t('sp.music.sounds')),
    grid,
    vol,
    h('div', { class: 'sp-hint' }, t('sp.music.soundsHint')));

  const btn = (name, label, fn, cls = '') => h('button', { class: ['sp-np-btn', cls], title: label, 'aria-label': label, html: icon(name, cls ? 30 : 26), onClick: fn });
  function drawCard() {
    const m = activeMedia();
    if (!m) {
      card.classList.add('idle');
      card.replaceChildren(
        h('div', { class: 'sp-np-art', html: icon('music', 40) }),
        h('div', { class: 'sp-np-t' }, t('sp.music.nothing')),
        h('div', { class: 'sp-np-s' }, t('sp.music.nothingHint')),
        h('button', { class: 'ou-btn tonal sp-np-open', onClick: () => openInBloom('music') }, t('sp.music.open')));
      return;
    }
    const { src, st } = m;
    card.classList.remove('idle');
    card.replaceChildren(
      h('div', { class: 'sp-np-art', style: { background: st.art ? null : st.color || 'var(--accent)' } }, st.art ? h('img', { src: st.art, alt: '' }) : h('span', { html: icon(st.icon || 'music', 40) })),
      h('bdi', { class: 'sp-np-t' }, st.title || ''),
      h('bdi', { class: 'sp-np-s' }, st.sub || ''),
      h('div', { class: 'sp-np-ctrl' },
        src.prev ? btn('prev', t('sp.music.prev'), () => src.prev()) : null,
        btn(st.playing ? 'pause' : 'play', st.playing ? t('sp.music.pause') : t('sp.music.play'), () => src.toggle(), 'pp'),
        src.next ? btn('next', t('sp.music.next'), () => src.next()) : null));
  }
  function drawSounds() {
    const s = sounds.state();
    grid.replaceChildren(...sounds.SOUNDS.map((x) => {
      const on = s.playing && s.id === x.id;
      return h('button', { class: ['sp-snd', on && 'on'], dataset: { sound: x.id }, 'aria-pressed': String(on), onClick: () => (on ? sounds.pause() : sounds.play(x.id)) },
        h('span', { class: 'sp-snd-ico', style: { background: x.color }, html: icon(on ? 'pause' : x.icon, 20) }),
        h('span', { class: 'sp-snd-name' }, sounds.soundName(x.id)));
    }));
  }
  drawCard();
  drawSounds();
  const offs = [onMediaChange(drawCard), sounds.onSoundChange(drawSounds)];
  return () => offs.forEach((f) => f());
}
