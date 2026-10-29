// Scenes: saved views of a board you can jump between, or step through with the arrows at the bottom. Each scene
// keeps the part of the board it showed, so it fits any window size.
import { h, $, escapeHtml as esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { menu, prompt, confirm } from '../core/ui.js';
import { popover } from './format.js';
import { renderItems, toBlob } from './export.js';

export function scenesPop(anchor, S) {
  const node = h('div', { class: 'cv-scenes' });
  const urls = [];
  const theme = () => (document.documentElement.dataset.theme === 'dark' ? 'd' : 'l');
  const draw = () => {
    node.innerHTML = `${S.scenes.length ? `<div class="cv-scn-list" role="list">${S.scenes.map((s, i) => `<div class="cv-scn-row ${i === S.cur ? 'on' : ''}" data-i="${i}" role="listitem" tabindex="0"><span class="cv-scn-th"><img alt=""></span><bdi>${esc(s.name)}</bdi><button data-more="${i}" title="${esc(t('common.more'))}" aria-label="${esc(t('common.more'))}">${icon('more', 20)}</button></div>`).join('')}</div>`
      : `<div class="cv-scn-empty">${icon('cv-scenes', 40)}<b>${esc(t('canvas.noScenes'))}</b><span>${esc(t('canvas.noScenesSub'))}</span></div>`}
      <button class="ou-btn tonal cv-scn-add" data-add="1">${icon('plus', 18)}<span>${esc(t('canvas.addScene'))}</span></button>`;
    S.scenes.forEach(async (s, i) => {
      try {
        const cv = await renderItems(S.items, { rect: s, fit: { w: 112, h: 70, max: 20 }, theme: theme() });
        const u = URL.createObjectURL(await toBlob(cv, 'image/png'));
        urls.push(u);
        const img = $(`[data-i="${i}"] img`, node);
        if (img) img.src = u;
      } catch { /* no preview */ }
    });
  };
  draw();
  const p = popover(anchor, node, { cls: 'cv-pop-scenes', title: t('canvas.scenes'), onClose: () => setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000) });
  node.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) { S.add(); draw(); p.place(); return; }
    const m = e.target.closest('[data-more]');
    if (m) { more(+m.dataset.more, m); return; }
    const row = e.target.closest('[data-i]');
    if (row) { p.close(); S.go(+row.dataset.i); }
  });
  node.addEventListener('keydown', (e) => { const row = e.target.closest('[data-i]'); if (row && e.key === 'Enter') { p.close(); S.go(+row.dataset.i); } });
  function more(i, at) {
    const s = S.scenes[i];
    if (!s) return;
    const move = (d) => { const a = [...S.scenes]; [a[i], a[i + d]] = [a[i + d], a[i]]; S.set(a); draw(); };
    p.close();
    menu(at, [
      { label: t('canvas.rename'), icon: 'edit', onClick: async () => { const n = (await prompt(t('canvas.renameScene'), { value: s.name, placeholder: t('canvas.sceneName') }))?.trim(); if (n) S.set(S.scenes.map((x, k) => (k === i ? { ...x, name: n } : x))); } },
      { label: t('canvas.updateScene'), icon: 'cv-restore', onClick: () => S.update(i) },
      i > 0 && { label: t('canvas.moveUp'), icon: 'up', onClick: () => move(-1) },
      i < S.scenes.length - 1 && { label: t('canvas.moveDown'), icon: 'down', onClick: () => move(1) },
      '-',
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: async () => { if (await confirm(t('canvas.deleteSceneQ'), s.name, { okLabel: t('common.delete'), danger: true })) S.set(S.scenes.filter((_, k) => k !== i)); } },
    ].filter(Boolean), { align: 'end' });
  }
}
