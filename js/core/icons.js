// Line icons in the One UI style: 24px grid, round caps, 1.8 stroke, currentColor.
//   icon('search')          -> SVG string
//   iconEl('search', 20)    -> SVGElement

const P = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  settings: '<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.6-1.5L14.2 2.6h-4l-.3 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-1c.8.7 1.6 1.2 2.6 1.5l.3 2.5h4l.3-2.5c1-.3 1.8-.8 2.6-1.5l2.3 1 2-3.4-2-1.5Z"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  forward: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  more: '<circle cx="12" cy="5.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5a1.6 1.6 0 0 0 1.6 1.5h6.8a1.6 1.6 0 0 0 1.6-1.5L18 7M9 7V4.6c0-.4.3-.6.6-.6h4.8c.3 0 .6.2.6.6V7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeComfort: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><path d="M12 9a3 3 0 1 0 3 3"/>',
  focus: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v4.5l3 2"/>',
  dnd: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
  flashlight: '<path d="M8 3h8v3l-2 4v10a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V10L8 6V3Z"/><path d="M12 13v2"/>',
  volume: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  vibrate: '<rect x="8" y="4" width="8" height="16" rx="2"/><path d="M4.5 9v6M19.5 9v6M2 10.5v3M22 10.5v3"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  play: '<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7Z" fill="currentColor"/>',
  pause: '<rect x="6.5" y="4.5" width="3.5" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="3.5" height="15" rx="1" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  next: '<path d="M5 5.5v13l9-6.5-9-6.5Z" fill="currentColor"/><path d="M18 5v14"/>',
  prev: '<path d="M19 5.5v13L10 12l9-6.5Z" fill="currentColor"/><path d="M6 5v14"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  bellOff: '<path d="M8 6.5A6 6 0 0 1 18 11v5.5l1.5 2H8M6 11v5.5l-1.5 2H11M10 20.5a2 2 0 0 0 4 0M3.5 3.5l17 17"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 7.8-1.3"/>',
  power: '<path d="M12 3v8"/><path d="M6.5 6.8a7.5 7.5 0 1 0 11 0"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  widgets: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="3.75"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="2"/><rect x="13" y="13" width="7.5" height="7.5" rx="2"/>',
  apps: '<circle cx="6" cy="6" r="1.7"/><circle cx="12" cy="6" r="1.7"/><circle cx="18" cy="6" r="1.7"/><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/><circle cx="6" cy="18" r="1.7"/><circle cx="12" cy="18" r="1.7"/><circle cx="18" cy="18" r="1.7"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19v-8.5Z"/>',
  star: '<path d="m12 3.8 2.5 5.1 5.6.8-4 4 1 5.5-5.1-2.7-5 2.7 1-5.5-4.1-4 5.6-.8L12 3.8Z"/>',
  starFill: '<path d="m12 3.8 2.5 5.1 5.6.8-4 4 1 5.5-5.1-2.7-5 2.7 1-5.5-4.1-4 5.6-.8L12 3.8Z" fill="currentColor"/>',
  pin: '<path d="M9 4h6l-1 5 3.5 3.5v1.5H6.5v-1.5L10 9 9 4ZM12 14v6.5"/>',
  share: '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="m8.7 10.8 6.6-4M8.7 13.2l6.6 4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.3 2.8 2.8L16.2 9.7"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alarm: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M4 5.5 7 3M20 5.5 17 3"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M10 2.5h4M12 13.5l3-3M19 6.5l1.5-1.5"/>',
  stopwatch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M10 2.5h4M12 6v1.5M12 13.5V10"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.7 5.4 3.7 8.5s-1.2 5.9-3.7 8.5c-2.5-2.6-3.7-5.4-3.7-8.5s1.2-5.9 3.7-8.5Z"/>',
  note: '<path d="M6 3.5h8l4.5 4.5v11A1.5 1.5 0 0 1 17 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M13.5 3.5V8.5h5M8 12.5h8M8 16h5"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1" fill="currentColor"/><circle cx="4.8" cy="12" r="1" fill="currentColor"/><circle cx="4.8" cy="17.5" r="1" fill="currentColor"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" stroke-width="2.4"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 11a3.8 3.8 0 0 0 1 7.5Z"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 7.5 3.8 3.8 0 0 0 7 15ZM8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
  drop: '<path d="M12 3.5s6 6.4 6 10.7a6 6 0 0 1-12 0c0-4.3 6-10.7 6-10.7Z"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/>',
  location: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  navigation: '<path d="M20 4 4 11l7 2 2 7 7-16Z"/>',
  battery: '<rect x="3" y="7.5" width="16" height="9" rx="2.5"/><path d="M21.5 10.5v3"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
  sparkle: '<path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z"/><path d="M19 15.5c.3 1.9 1 2.6 2.5 3-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.4 2.2-1.1 2.5-3Z"/>',
  mic: '<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  folder: '<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V7Z"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
  upload: '<path d="M12 15.5v-11M7 9l5-5 5 5M5 19.5h14"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l3 2"/>',
  bookmark: '<path d="M6.5 3.5h11V20.5L12 16.5l-5.5 4V3.5Z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  brightness: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3"/>',
  edge: '<rect x="4.5" y="3" width="15" height="18" rx="3"/><path d="M16.5 8v8" stroke-width="2.6"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4v5h-5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.3 0 1.8-.9 1.4-2-.5-1.2.2-2.5 1.6-2.5h2A3.5 3.5 0 0 0 20.5 12 8.5 8.5 0 0 0 12 3.5Z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor"/><circle cx="10" cy="7.3" r="1.1" fill="currentColor"/><circle cx="14.5" cy="7.3" r="1.1" fill="currentColor"/>',
  text: '<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 9.5h.01M9.3 9.5h.01M12.6 9.5h.01M15.9 9.5h.01M18 9.5h.01M7.5 14.5h9" stroke-width="2"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
  hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15a6.5 6.5 0 0 1-6.5 6.5h-1.3a6.5 6.5 0 0 1-5.3-2.8L4 15.2a1.6 1.6 0 0 1 2.6-1.8L8 15"/>',
  fingerprint: '<path d="M6.8 5.6A8.5 8.5 0 0 1 20.3 12M3.7 9.8A8.5 8.5 0 0 0 3.5 12M7 19.4A9.9 9.9 0 0 0 8.5 12a3.5 3.5 0 0 1 7 0c0 1.6-.1 3.2-.5 4.7M12 12c0 3.6-.8 6.5-2.4 9M18.7 15.5c-.2 1.5-.6 3-1.2 4.4M12.1 7.5"/>',
  arrowUp: '<path d="M12 19.5V5M6 11l6-6 6 6"/>',
  arrowRight: '<path d="M4.5 12H19M13 6l6 6-6 6"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  tab: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18M8 5v4"/>',
  waves: '<path d="M2.5 9c2.4 0 2.4-2 4.75-2S9.6 9 12 9s2.4-2 4.75-2S19.1 9 21.5 9M2.5 15c2.4 0 2.4-2 4.75-2S9.6 15 12 15s2.4-2 4.75-2 2.35 2 4.75 2"/>',
  airplane: '<path d="M10.5 20.5v-2l2-1.5v-4l7 2.5v-2l-7-5V4.5a1.5 1.5 0 0 0-3 0V8.5l-7 5v2l7-2.5v4l2 1.5v2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  sort: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>',
  layout: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M10 9.5V20"/>',
  font: '<path d="M4.5 19.5 10 4.5h1l5.5 15M7 13h7M17 15.5c0-1.6 1.1-2.5 2.5-2.5s2 .9 2 2.2v4.3M21.5 17c-.7-.3-1.4-.4-2-.4-1.4 0-2.5.6-2.5 1.6s.8 1.4 1.8 1.4 2.1-.7 2.7-1.6"/>',
  sound: '<path d="M4 15.5v-7M8 18.5v-13M12 15.5v-7M16 20V4M20 15.5v-7"/>',
};

/** Lets a module bring its own glyphs (same 24px line style) instead of editing this table: addIcons({ pill: '<path…/>' }). */
export function addIcons(map) {
  Object.assign(P, map);
}

// The `back` and `forward` chevrons mirror themselves in Arabic (css/app.css: [dir=rtl] .ico-back/.ico-forward), so
// callers never flip them or their containers again.
export function icon(name, size = 24, extra = '') {
  const body = P[name] || P.info;
  return `<svg class="ico ico-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
}

export function iconEl(name, size = 24) {
  const t = document.createElement('template');
  t.innerHTML = icon(name, size);
  return t.content.firstElementChild;
}

export const hasIcon = (name) => name in P;
