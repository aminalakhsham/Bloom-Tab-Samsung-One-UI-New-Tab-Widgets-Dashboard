// Voice Recorder waveforms on <canvas>: the scrolling waveform with its time ruler, bookmarks and the red playhead in
// the middle (recording and playing back, like Samsung's), and the whole recording fitted to a strip (Trim). Media
// time runs left to right in every language, as One UI keeps media timelines unmirrored.

/** Sizes the canvas for the screen's pixel ratio; returns its 2D context in CSS pixels. */
export function fit(c) {
  // layout size, not getBoundingClientRect(): the window zooms in with a transform when it opens
  const r = { width: c.clientWidth, height: c.clientHeight }, dpr = devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  return { ctx, w: r.width, h: r.height };
}
/** Colours come from the canvas's CSS custom properties, so light and dark just work. */
export function colors(c) {
  const s = getComputedStyle(c), v = (k, d) => s.getPropertyValue(k).trim() || d;
  return { bar: v('--rw-bar', '#222'), rec: v('--rw-rec', '#f4483f'), dim: v('--rw-dim', '#bbb'), head: v('--rw-head', '#f4483f'), tick: v('--rw-tick', '#999'), mark: v('--rw-mark', '#3e91ff'), rep: v('--rw-rep', 'rgba(62,145,255,.14)'), font: s.fontFamily };
}
// quiet speech should still show: a gentle curve, like a level meter
const level = (v) => Math.pow(v / 255, 0.55);
function bar(ctx, x, y, h, w) {
  h = Math.max(1.5, h);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y, w, h, w / 2);
  ctx.fill();
}
function flag(ctx, x, y, col) {
  ctx.fillStyle = col;
  ctx.fillRect(x - 0.75, y, 1.5, 12);
  ctx.beginPath();
  ctx.moveTo(x + 0.75, y);
  ctx.lineTo(x + 8, y + 3);
  ctx.lineTo(x + 0.75, y + 6.5);
  ctx.closePath();
  ctx.fill();
}

/**
 * The scrolling waveform: the playhead stays in the middle and the recording moves past it.
 * o = { pk (Uint8Array, edited order), pk2 (the second person, Interview), split (two halves), pr (per second),
 *       t (s), len (s), recording, marks: [t…], repeat: { a, b } | null, pxps, label(s) → text }
 */
export function drawScroll(c, o) {
  const { ctx, w, h } = fit(c), col = colors(c);
  const pxps = o.pxps || 60, cx = Math.round(w / 2), top = 40, bot = h - 8, mid = (top + bot) / 2;
  const t0 = o.t - cx / pxps, t1 = o.t + (w - cx) / pxps, X = (s) => cx + (s - o.t) * pxps;
  const end = o.recording ? o.t : o.len;
  // repeated section
  if (o.repeat) {
    const a = X(o.repeat.a), b = o.repeat.b != null ? X(o.repeat.b) : cx;
    ctx.fillStyle = col.rep;
    ctx.fillRect(Math.min(a, b), top - 6, Math.abs(b - a), bot - top + 6);
  }
  // time ruler: a tick every half second, a label every few seconds
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pxps >= 64) || 600;
  ctx.fillStyle = col.tick;
  ctx.font = `500 11px ${col.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillRect(0, top - 6, w, 1);
  for (let s = Math.max(0, Math.floor(t0 * 2) / 2); s <= Math.min(t1, end + 0.001); s += 0.5) {
    const x = X(s), major = Math.abs(s % step) < 1e-6;
    ctx.fillRect(x - 0.5, top - 6 - (major ? 8 : 4), 1, major ? 8 : 4);
    if (major && o.label) ctx.fillText(o.label(s), x, top - 18);
  }
  // the centre line, dotted where nothing is recorded yet
  ctx.fillStyle = col.dim;
  if (o.split) ctx.fillRect(0, mid - 0.5, w, 1);
  else for (let x = o.recording ? cx + 4 : Math.max(0, X(end)) + 4; x < w; x += 6) ctx.fillRect(x, mid - 0.5, 2, 1);
  const pr = o.pr || 20, bw = Math.max(1, Math.min(3, (pxps / pr) * 0.6));
  const draw = (pk, half) => {
    if (!pk?.length) return;
    const amp = (half ? bot - mid - 2 : (bot - top) / 2) * 0.86;
    const i0 = Math.max(0, Math.floor(t0 * pr)), i1 = Math.min(pk.length, Math.ceil(t1 * pr) + 1);
    for (let i = i0; i < i1; i++) {
      const x = X((i + 0.5) / pr);
      if (o.recording && x > cx + 1) continue;
      ctx.fillStyle = o.recording ? col.rec : x <= cx ? col.bar : col.dim;
      const hh = Math.max(1.5, level(pk[i]) * amp * (half ? 1 : 2));
      if (half === 'up') bar(ctx, x, mid - 1 - hh, hh, bw);
      else if (half === 'down') bar(ctx, x, mid + 1, hh, bw);
      else bar(ctx, x, mid - hh / 2, hh, bw);
    }
  };
  if (o.split) {
    draw(o.pk, 'up');
    draw(o.pk2 || o.pk, 'down');
  } else draw(o.pk);
  // bookmarks: small flags on the ruler and a faint line
  for (const s of o.marks || []) {
    const x = X(s);
    if (x < -10 || x > w + 10) continue;
    ctx.fillStyle = col.mark;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x - 0.5, top - 4, 1, bot - top + 4);
    ctx.globalAlpha = 1;
    flag(ctx, x, top - 6 - 12, col.mark);
  }
  // playhead: a red line with a dot on the ruler
  ctx.fillStyle = col.head;
  ctx.fillRect(cx - 1, top - 8, 2, bot - top + 8);
  ctx.beginPath();
  ctx.arc(cx, top - 8, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

/** The whole recording in one strip. o = { pk, len, t (playhead or null), gap, marks: [t…], sel: { a, b } } */
export function drawFit(c, o) {
  const { ctx, w, h } = fit(c), col = colors(c);
  const pk = o.pk || [], gap = o.gap ?? 3, n = Math.max(1, Math.floor(w / gap)), mid = h / 2, amp = h / 2 - 2;
  const per = pk.length / n, X = (s) => (o.len ? (s / o.len) * w : 0);
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = Math.floor(i * per), b = Math.max(a + 1, Math.floor((i + 1) * per));
    for (let j = a; j < b && j < pk.length; j++) if (pk[j] > m) m = pk[j];
    const x = i * gap + gap / 2;
    const inSel = !o.sel || (x >= X(o.sel.a) && x <= X(o.sel.b));
    ctx.fillStyle = inSel ? col.bar : col.dim;
    const hh = Math.max(1.5, level(m) * amp * 2);
    bar(ctx, x, mid - hh / 2, hh, Math.max(1, gap * 0.55));
  }
  for (const s of o.marks || []) {
    ctx.fillStyle = col.mark;
    ctx.fillRect(Math.round(X(s)) - 0.5, 0, 1, h);
  }
  if (o.t != null && o.len) {
    ctx.fillStyle = col.head;
    ctx.fillRect(Math.round(X(o.t)) - 1, 0, 2, h);
  }
}
