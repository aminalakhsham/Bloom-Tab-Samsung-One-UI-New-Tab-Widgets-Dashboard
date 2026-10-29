// Small pieces shared by the Reminder app, its widget and its editor: the extra icons, the round checkbox and the
// category badge (a white glyph on the category's colour).
import { h } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t } from '../core/i18n.js';

addIcons({
  rmRepeat: '<path d="M17 3.5 20 6.5l-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12"/><path d="M7 20.5 4 17.5l3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/>',
  rmEarly: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14l1.5-2Z"/><path d="M10 21h4"/><path d="M12 8.5V11l1.6 1.2"/>',
  rmSub: '<path d="M5 4v9.5a2.5 2.5 0 0 0 2.5 2.5H12"/><circle cx="16" cy="16" r="3.5"/><path d="m14.6 16 1 1 1.8-1.9"/><circle cx="5" cy="4" r=".6" fill="currentColor"/>',
  rmGrip: '<path d="M5 9h14M5 15h14"/>',
  rmFolder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z"/><path d="M8.5 13h7M12 9.5v7"/>',
  rmSelect: '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
  rmWork: '<rect x="3.5" y="7" width="17" height="12.5" rx="2.5"/><path d="M9 7V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6V7M3.5 12.4h17"/>',
  rmHome: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-3.8V15h-5.4v5.5H5.5A1.5 1.5 0 0 1 4 19v-8.5Z"/>',
  rmCart: '<path d="M3.5 4.5h2.2l2.1 10.4a1.6 1.6 0 0 0 1.6 1.3h7.7a1.6 1.6 0 0 0 1.6-1.2l1.6-6.5H6.6"/><circle cx="9.5" cy="19.5" r="1.2"/><circle cx="17" cy="19.5" r="1.2"/>',
  rmHeart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/>',
  rmBook: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15.5H5.5A1.5 1.5 0 0 1 4 18V5.5ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15.5h5.5A1.5 1.5 0 0 0 20 18V5.5Z"/>',
  rmPlane: '<path d="M10.5 13.5 4 11l1.3-1.3 7.4.7 3.9-3.9a2 2 0 0 1 2.8 2.8l-3.9 3.9.7 7.4-1.3 1.3-2.5-6.5-3 3v2.4l-1 1-1.5-3-3-1.5 1-1h2.4l3-3Z"/>',
  rmGift: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M3.5 9h17M12 9v11M12 9S10.8 4.5 8.4 4.5a2.2 2.2 0 0 0 0 4.5H12Zm0 0s1.2-4.5 3.6-4.5a2.2 2.2 0 0 1 0 4.5H12Z"/>',
  rmFit: '<path d="M6.5 8v8M17.5 8v8M3.5 10.5v3M20.5 10.5v3M6.5 12h11"/>',
  rmMoney: '<rect x="3" y="6.5" width="18" height="11" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
  rmPaw: '<circle cx="7" cy="10" r="1.7"/><circle cx="10.5" cy="6.5" r="1.7"/><circle cx="14.5" cy="6.5" r="1.7"/><circle cx="18" cy="10" r="1.7"/><path d="M12 12c-2.8 0-5 3.4-5 5.4 0 1.7 1.5 2.1 2.7 1.7l1.3-.4a3.2 3.2 0 0 1 2 0l1.3.4c1.2.4 2.7 0 2.7-1.7 0-2-2.2-5.4-5-5.4Z"/>',
});

/** The round One UI checkbox of a reminder. */
export function checkbox(r, onToggle) {
  return h('button', {
    class: ['rem-check', r.done && 'done', r.priority && 'important'],
    role: 'checkbox',
    'aria-checked': String(!!r.done),
    'aria-label': r.title || t('common.untitled'),
    html: icon('check', 16),
    onClick: (e) => {
      e.stopPropagation();
      onToggle(e);
    },
  });
}

/** A category's round badge: its icon in white on its colour. */
export const catBadge = (c, size = 18) => h('span', { class: 'rem-badge', style: { '--c': c?.color || '#3e7bff' }, html: icon(c?.icon || 'list', size) });
