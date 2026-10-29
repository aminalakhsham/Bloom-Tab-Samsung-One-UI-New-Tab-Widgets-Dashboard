// Keyboard shortcuts for the whole shell.
//   Alt+L lock · Alt+A apps · Ctrl/Cmd+K or / Finder · Alt+Q Quick panel · Alt+E Edge panel · Alt+R Recents
//   Alt+, Settings · ←/→ pages · type anywhere to search · Esc closes the top layer
// App windows handle their own keys while one of them has the focus (core/apps.js); clicking the Home screen
// behind floating windows gives the keys back to the shell.
import { openApp, currentApp } from '../core/apps.js';
import { goPage, setEditing } from './home.js';
import { openFinder, isFinderOpen, closeFinder } from './finder.js';
import { openDrawer, closeDrawer, isDrawerOpen } from './drawer.js';
import { openQuickPanel, closeQuickPanel, isQuickPanelOpen } from './quickpanel.js';
import { openEdge, closeEdge, isEdgeOpen } from './edge.js';
import { lockNow, isLocked } from './lock.js';
import { isRtl } from '../core/i18n.js';
import { toggleRecents, isRecentsOpen, initRecents } from './recents.js';

const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
const overlayOpen = () => document.querySelector('.ou-dialog-scrim, .ou-menu-scrim, .folder-scrim, .aod, #recents');

export function initKeys() {
  initRecents();
  addEventListener('keydown', (e) => {
    if (isLocked() || e.defaultPrevented) return;
    const k = e.key.toLowerCase();
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const map = { l: lockNow, a: () => (isDrawerOpen() ? closeDrawer() : openDrawer()), q: () => (isQuickPanelOpen() ? closeQuickPanel() : openQuickPanel()), e: () => (isEdgeOpen() ? closeEdge() : openEdge()), r: toggleRecents, ',': () => openApp('settings') };
      // by physical key too: on macOS Option+letter types a symbol (Option+L = "¬")
      const fn = map[k] || map[{ KeyL: 'l', KeyA: 'a', KeyQ: 'q', KeyE: 'e', KeyR: 'r', Comma: ',' }[e.code]];
      if (fn) {
        e.preventDefault();
        return fn();
      }
    }
    if ((e.ctrlKey || e.metaKey) && k === 'k') {
      e.preventDefault();
      return isFinderOpen() ? closeFinder() : openFinder();
    }
    // the Apps screen, Finder, the Quick Panel and the Edge panel sit above the windows: Escape closes them first
    if (e.key === 'Escape' && !typing(e) && !overlayOpen() && !isRecentsOpen() && (isFinderOpen() || isQuickPanelOpen() || isDrawerOpen() || isEdgeOpen())) {
      if (isFinderOpen()) closeFinder();
      else if (isQuickPanelOpen()) closeQuickPanel();
      else if (isDrawerOpen()) closeDrawer();
      else closeEdge();
      return;
    }
    if (typing(e) || overlayOpen() || currentApp()) return;

    if (e.key === 'Escape') {
      if (isFinderOpen()) closeFinder();
      else if (isQuickPanelOpen()) closeQuickPanel();
      else if (isDrawerOpen()) closeDrawer();
      else if (isEdgeOpen()) closeEdge();
      else setEditing(false);
      return;
    }
    if (isFinderOpen() || isQuickPanelOpen() || isDrawerOpen()) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const cur = document.querySelector('.page-dots .dot.active');
      const i = cur ? [...cur.parentNode.children].indexOf(cur) : 0;
      const dir = (e.key === 'ArrowRight' ? 1 : -1) * (isRtl() ? -1 : 1);
      goPage(i + dir);
      return;
    }
    if (e.key === 'ArrowUp' && !e.target.closest('.tile')) return openDrawer();
    if (e.key === 'ArrowDown' && !e.target.closest('.tile')) return openQuickPanel();
    // start typing anywhere -> Finder
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      e.preventDefault();
      openFinder(e.key === '/' ? '' : e.key);
    }
  });
}
