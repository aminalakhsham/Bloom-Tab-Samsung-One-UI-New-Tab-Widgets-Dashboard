// Widget registry. The home screen owns layout; a widget only fills its box.
//
// registerWidget({
//   id: 'weather',
//   name: 'widget.weather' | { en, ar },
//   sizes: ['s', 'm', 'l'],        // s = 2×2 cells, m = 4×2, l = 4×4
//   defaultSize: 's',
//   app: 'weather',                // clicking the widget opens this app (unless onClick is given)
//   onClick(item, el),             // optional custom click
//   render(el, { size, item, config, setConfig, preview }) -> cleanup?
//   configure: async (config, { size, item, isNew }) => newConfig | null,   // optional
// })
//
// The box `el` already has class "wg w-<size>" (rounded glass card, padding). Useful classes from
// shell.css: .wg-head (small label row), .wg-big (large numbers), .wg-sub, .wg-list, .wg-fill (no padding).
//
// `configure` is the widget's settings step, as on One UI ("Widget settings"): the widget picker calls it before
// a new widget lands (isNew: true; return null to cancel adding it), and the widget's menu offers "Settings" to
// call it again with the current config. It usually opens a dialog()/choose() from core/ui.js (pick a routine,
// a card, a city…) and resolves with the whole new config object, which the Home screen saves in item.config and
// passes to render(). Home's addWidget(id, size, config) also takes a ready config (e.g. "Add to Home screen"
// from inside an app).

const registry = new Map();

export function registerWidget(w) {
  registry.set(w.id, { sizes: ['s'], defaultSize: w.sizes?.[0] || 's', ...w });
}

export const getWidget = (id) => registry.get(id);
export const getWidgets = () => [...registry.values()];

/** Runs a widget's settings step. Resolves with the new config, or null when there is none or it was cancelled. */
export async function configureWidget(w, config = {}, extra = {}) {
  if (typeof w?.configure !== 'function') return null;
  try {
    const next = await w.configure({ ...(config || {}) }, extra);
    return next && typeof next === 'object' ? next : null;
  } catch (e) {
    console.error('widget configure', w.id, e);
    return null;
  }
}

/** Grid span for a size, in cells: [cols, rows]. */
export const SIZE_SPAN = { s: [2, 2], m: [4, 2], l: [4, 4] };

// ——— a Home screen nobody can see ———
// While an opaque maximized window or split screen, the Lock screen, the Daily Board or Always On Display hides the
// whole Home screen, js/shell/home.js sets body.home-hidden, which skips its rendering (`content-visibility: hidden`:
// CSS animations such as clock hands stop costing frames). A widget with per-frame work of its own (a canvas, a
// requestAnimationFrame loop, a fast timer) pauses it here and resumes when the Home screen shows again:
//   const off = onHomeHidden((hidden) => (hidden ? stopLoop() : startLoop()));   // return off from render()'s cleanup
// Pop-up windows floating over a visible Home screen don't hide it.
let homeIsHidden = false;
const hiddenFns = new Set();
export const homeHidden = () => homeIsHidden;
export const onHomeHidden = (fn) => (hiddenFns.add(fn), () => hiddenFns.delete(fn));
/** Called by the Home screen only. */
export function setHomeHidden(v) {
  if (!!v === homeIsHidden) return;
  homeIsHidden = !!v;
  document.body.classList.toggle('home-hidden', homeIsHidden);
  for (const fn of [...hiddenFns]) {
    try {
      fn(homeIsHidden);
    } catch (e) {
      console.error('onHomeHidden', e);
    }
  }
}
