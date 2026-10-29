// Edge panel: Samsung's handle on the side of the screen that slides out your favourite apps.
import { h, $, uid, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, addStrings } from '../core/i18n.js';
import { store, setting, setSetting, onSetting } from '../core/store.js';
import { getApps } from '../core/apps.js';
import { menu, toast, dialog } from '../core/ui.js';
import { itemIconEl, itemLabel, openItem } from './appicon.js';
import { allItems } from './home.js';

let el, handle, panel, open = false;

const items = () => store.get('edge') || [];

export function addToEdge(item) {
  const list = items();
  const key = item.type === 'app' ? 'app:' + item.app : item.url;
  if (list.some((x) => (x.type === 'app' ? 'app:' + x.app : x.url) === key)) return toast(t('edge.already'));
  if (list.length >= 12) return toast(t('edge.full'));
  store.set('edge', [...list, { ...item, id: uid() }]);
  toast(t('edge.added'));
}

function render() {
  const list = items();
  panel.replaceChildren(
    h('div', { class: 'edge-title' }, t('edge.title')),
    h('div', { class: 'edge-grid' },
      list.map((it) => {
        const tile = h('button', { class: 'edge-item', title: itemLabel(it) }, itemIconEl(it), h('span', null, itemLabel(it)));
        tile.addEventListener('click', (e) => {
          closeEdge();
          openItem(it, tile.querySelector('.app-icon'), e);
        });
        tile.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          menu(e, [{ label: t('common.remove'), icon: 'trash', danger: true, onClick: () => store.set('edge', items().filter((x) => x.id !== it.id)) }]);
        });
        return tile;
      }),
      list.length < 12 ? h('button', { class: 'edge-item edge-add', title: t('common.add'), onClick: editEdge }, h('span', { class: 'app-icon edge-plus', html: icon('plus', 26) }), h('span', null, t('common.add'))) : null),
    h('button', { class: 'edge-settings', title: t('edge.edit'), html: icon('edit', 20), onClick: editEdge }));
}

async function editEdge() {
  const current = items();
  const keyOf = (x) => (x.type === 'app' ? 'app:' + x.app : x.url);
  const picked = new Set(current.map(keyOf));
  const cands = [
    ...getApps().filter((a) => !a.hidden).map((a) => ({ type: 'app', app: a.id })),
    ...allItems().filter((x) => x.type === 'site'),
  ].filter((x, i, arr) => arr.findIndex((y) => keyOf(y) === keyOf(x)) === i);
  const grid = h('div', { class: 'edge-pick' },
    cands.map((c) => {
      const b = h('button', { class: ['edge-pick-item', picked.has(keyOf(c)) && 'on'] }, itemIconEl(c), h('span', null, itemLabel(c)), h('i', { html: icon('check', 14) }));
      b.addEventListener('click', () => {
        const k = keyOf(c);
        if (picked.has(k)) picked.delete(k);
        else if (picked.size < 12) picked.add(k);
        b.classList.toggle('on', picked.has(k));
      });
      return b;
    }));
  const ok = await dialog({ title: t('edge.edit'), message: t('edge.editHint'), content: grid, className: 'wide', actions: [{ label: t('common.cancel'), value: false }, { label: t('common.done'), value: true, primary: true }] });
  if (!ok) return;
  const keep = current.filter((x) => picked.has(keyOf(x)));
  const added = cands.filter((c) => picked.has(keyOf(c)) && !keep.some((x) => keyOf(x) === keyOf(c))).map((c) => ({ ...c, id: uid() }));
  store.set('edge', [...keep, ...added]);
}

export function openEdge() {
  if (open || !setting('edgePanel') || document.body.classList.contains('locked')) return;
  open = true;
  render();
  el.classList.add('show');
}

export function closeEdge() {
  if (!open) return;
  open = false;
  el.classList.remove('show');
}

export const isEdgeOpen = () => open;

function place() {
  const side = setting('edgeSide');
  el.dataset.side = side;
  el.hidden = !setting('edgePanel');
  handle.style.top = clamp(setting('edgeHandleY'), 10, 80) + '%';
}

export function initEdge() {
  el = $('#edge');
  handle = h('button', { class: 'edge-handle', 'aria-label': t('edge.title') });
  panel = h('div', { class: 'edge-panel' });
  el.replaceChildren(handle, panel);

  if (!Array.isArray(store.get('edge'))) {
    const seed = ['notes', 'calculator', 'reminder', 'calendar', 'clock', 'weather'].filter((id) => getApps().some((a) => a.id === id)).map((id) => ({ id: uid(), type: 'app', app: id }));
    store.set('edge', seed);
  }

  // swipe the handle inwards, click it, or drag it up/down to move it
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, y0 = setting('edgeHandleY');
    let moved = false;
    const mv = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      // by where the handle really is: its CSS is logical, so "right" sits on the left in RTL
      const inward = handle.getBoundingClientRect().left > innerWidth / 2 ? -dx : dx;
      if (inward > 24) {
        off();
        openEdge();
      } else if (Math.abs(dy) > 10) {
        moved = true;
        handle.style.top = clamp(y0 + (dy / innerHeight) * 100, 10, 80) + '%';
      }
    };
    const off = (ev) => {
      handle.removeEventListener('pointermove', mv);
      handle.removeEventListener('pointerup', off);
      if (moved && ev) setSetting('edgeHandleY', Math.round(parseFloat(handle.style.top)));
      else if (ev && !open) openEdge();
    };
    handle.addEventListener('pointermove', mv);
    handle.addEventListener('pointerup', off);
  });
  el.addEventListener('pointerdown', (e) => {
    if (e.target === el) closeEdge();
  });
  addEventListener('pointerdown', (e) => {
    if (open && !el.contains(e.target) && !e.target.closest('.ou-dialog-scrim, .ou-menu-scrim')) closeEdge();
  }, true);
  store.on('edge', () => open && render());
  place();
  ['edgePanel', 'edgeSide', 'edgeHandleY'].forEach((k) => onSetting(k, place));
}

addStrings({
  en: {
    'edge.title': 'Apps edge',
    'edge.edit': 'Edit Edge panel',
    'edge.editHint': 'Choose up to 12 apps and websites.',
    'edge.added': 'Added to Edge panel',
    'edge.already': 'Already in the Edge panel',
    'edge.full': 'The Edge panel is full',
  },
  ar: {
    'edge.title': 'تطبيقات الحافة',
    'edge.edit': 'تعديل لوحة الحافة',
    'edge.editHint': 'اختر حتى 12 تطبيقًا وموقعًا.',
    'edge.added': 'تمت الإضافة إلى لوحة الحافة',
    'edge.already': 'موجود بالفعل في لوحة الحافة',
    'edge.full': 'لوحة الحافة ممتلئة',
  },
});

