// Clock's window: the four tabs at the bottom (Alarm, World clock, Stopwatch, Timer), each a page of its own module.
// Opens on the tab asked for (params.tab, or params.section from a notification), else on a running timer or
// stopwatch, else where it was left.
import * as D from './data.js';
import { tabsBar, openSettings } from './kit.js';
import { alarmView } from './alarm.js';
import { worldView } from './world.js';
import { stopwatchView } from './stopwatch.js';
import { timerView } from './timer.js';

const VIEWS = { alarm: alarmView, world: worldView, stopwatch: stopwatchView, timer: timerView };
let lastTab = 'alarm';

export function render(ctx) {
  let cleanup = null;
  const pick = (p) => {
    const tab = p?.tab || p?.section;
    return VIEWS[tab] ? tab : null;
  };
  const defaultTab = () => {
    if (D.timers().some((x) => x.running)) return 'timer';
    if (D.stopwatch().running) return 'stopwatch';
    return lastTab;
  };
  const show = (tab) => {
    try {
      cleanup?.();
    } catch (e) {
      console.error(e);
    }
    lastTab = tab;
    cleanup = VIEWS[tab](ctx, tabsBar(tab, show), { settings: () => openSettings(ctx) });
  };
  ctx.setParams = (p) => {
    const tab = pick(p);
    if (tab) show(tab);
  };
  show(pick(ctx.params) || defaultTab());
  return () => cleanup?.();
}
