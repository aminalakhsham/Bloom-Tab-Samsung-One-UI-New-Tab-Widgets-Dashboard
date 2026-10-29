// Mood (State of Mind) for entries, Samsung Health style: five coloured faces from Awful to Great, then the feelings
// that describe it and what's affecting it, as chips.
import { h } from '../core/util.js';
import { t } from '../core/i18n.js';
import { dialog } from '../core/ui.js';
import * as M from './model.js';

const INK = 'rgba(20, 16, 40, .78)';
// Eyes and mouth of each level on a 40×40 face.
const FEATURES = {
  1: `<path d="M12.4 16.6l3.8-1.8M27.6 16.6l-3.8-1.8" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/><circle cx="14.8" cy="19" r="1.9" fill="${INK}"/><circle cx="25.2" cy="19" r="1.9" fill="${INK}"/><path d="M13.6 29.6c3.6-4.4 9.2-4.4 12.8 0" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`,
  2: `<circle cx="14.8" cy="17" r="2" fill="${INK}"/><circle cx="25.2" cy="17" r="2" fill="${INK}"/><path d="M14.6 27.6c3.2-2.4 7.6-2.4 10.8 0" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`,
  3: `<circle cx="14.8" cy="17" r="2" fill="${INK}"/><circle cx="25.2" cy="17" r="2" fill="${INK}"/><path d="M14.5 26h11" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`,
  4: `<circle cx="14.8" cy="16.6" r="2" fill="${INK}"/><circle cx="25.2" cy="16.6" r="2" fill="${INK}"/><path d="M13.8 24.2c3.4 3.8 9 3.8 12.4 0" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`,
  5: `<path d="M11.8 17.6c1.2-2.2 4.4-2.2 5.6 0M22.6 17.6c1.2-2.2 4.4-2.2 5.6 0" fill="none" stroke="${INK}" stroke-width="2.3" stroke-linecap="round"/><path d="M12.6 22.6h14.8c-.6 4.4-3.6 7-7.4 7s-6.8-2.6-7.4-7Z" fill="${INK}"/><path d="M15.6 27.2c2.6 1.6 6.2 1.6 8.8 0" fill="none" stroke="#ff8a80" stroke-width="2" stroke-linecap="round"/>`,
};

/** The face of a mood level as an SVG string. */
export function moodFace(level, size = 32) {
  const m = M.moodOf(level);
  if (!m) return '';
  return `<svg class="jr-face" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="${m.color}"/>${FEATURES[m.level]}</svg>`;
}
export const moodName = (level) => (M.moodOf(level) ? t('journal.mood.' + M.moodOf(level).id) : '');
export const feelingName = (id) => t('journal.feel.' + id);
export const areaName = (id) => t('journal.area.' + id);

/**
 * The mood sheet: pick a face, then optional feelings and areas. Resolves { level, feelings, areas }, 'remove', or null.
 */
export function pickMood(cur) {
  let level = cur?.level || 0;
  const feelings = new Set(cur?.feelings || []), areas = new Set(cur?.areas || []);
  const name = h('div', { class: 'jr-mood-name' });
  const faces = h('div', { class: 'jr-mood-faces', role: 'radiogroup', 'aria-label': t('journal.moodQ') });
  const more = h('div', { class: 'jr-mood-more' });
  const chips = (ids, set, label) => h('div', { class: 'ou-chips jr-mood-chips' }, ids.map((id) => {
    const b = h('button', { class: ['ou-chip', set.has(id) && 'active'], 'aria-pressed': String(set.has(id)), onClick: () => {
      set.has(id) ? set.delete(id) : set.add(id);
      b.classList.toggle('active', set.has(id));
      b.setAttribute('aria-pressed', String(set.has(id)));
    } }, label(id));
    return b;
  }));
  const draw = () => {
    faces.replaceChildren(...[...M.MOODS].reverse().map((m) => h('button', {
      class: ['jr-mood-btn', m.level === level && 'on'],
      role: 'radio',
      'aria-checked': String(m.level === level),
      'aria-label': moodName(m.level),
      title: moodName(m.level),
      style: { '--mc': m.color },
      dataset: { level: m.level },
      onClick: () => {
        level = m.level;
        draw();
      },
    }, h('span', { html: moodFace(m.level, 46) }), h('small', null, moodName(m.level)))));
    name.textContent = level ? moodName(level) : t('journal.moodPick');
    name.style.color = level ? M.moodOf(level).color : '';
    more.hidden = !level;
  };
  more.append(
    h('div', { class: 'jr-mood-h' }, t('journal.moodFeel')), chips(M.FEELINGS, feelings, feelingName),
    h('div', { class: 'jr-mood-h' }, t('journal.moodAreas')), chips(M.AREAS, areas, areaName));
  draw();
  const actions = [];
  if (cur) actions.push({ label: t('common.remove'), value: 'remove', danger: true });
  actions.push({ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => ({ level, feelings: [...feelings], areas: [...areas] }), primary: true, validate: () => !!level });
  return dialog({ title: t('journal.moodQ'), className: 'jr-mood-dlg', content: h('div', { class: 'jr-mood' }, faces, name, more), actions });
}
