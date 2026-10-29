// Hourly charts of the Weather detail pages: smooth lines (with a gradient stroke and a soft fill), bars, a row of
// icons, high/low marks, the past part of today dimmed, a "now" line and pointer scrubbing that reports the hour.
// Time runs right-to-left in Arabic (the SVG itself is laid out left-to-right, so text anchors are absolute).
// Adapted from Liquid Tab's weather-detail.js.
import { escapeHtml as esc } from '../core/util.js';
import { isRtl } from '../core/i18n.js';

const H = 36e5;

function niceTicks(min, max, n = 4) {
  const span = Math.max(1e-6, max - min), raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) || 10 * mag;
  const a = Math.floor(min / step) * step, b = Math.ceil(max / step) * step, out = [];
  for (let v = a; v <= b + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Monotone cubic path through the points (no overshoot between hours). */
function smooth(pts) {
  if (pts.length < 2) return '';
  const n = pts.length, dx = [], m = [], s = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    s[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1);
  }
  m[0] = s[0];
  m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / s[i], b = m[i + 1] / s[i], hh = a * a + b * b;
    if (hh > 9) {
      const k = 3 / Math.sqrt(hh);
      m[i] = k * a * s[i];
      m[i + 1] = k * b * s[i];
    }
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const hh = dx[i] / 3;
    d += `C${(pts[i][0] + hh).toFixed(1)} ${(pts[i][1] + m[i] * hh).toFixed(1)} ${(pts[i + 1][0] - hh).toFixed(1)} ${(pts[i + 1][1] - m[i + 1] * hh).toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

/**
 * o: { start, end, times[], hourLabel(ms), lines: [{ v[], stroke, grad: [[value, color]], fill, dash, dim }],
 *      bars: [{ v[], color | colorOf(v) }], min, max, ticks, fmtY(v), now, icons: [{ t, html }], marks: [{ i, label, below }], h }
 * → { svg, X, Y }
 */
export function chartSVG(o) {
  const W = 640, Hh = o.h || 220, rtl = isRtl(), top = o.icons ? 34 : 14, bottom = 24;
  const L = rtl ? 46 : 6, R = rtl ? 6 : 46, pw = W - L - R, ph = Hh - top - bottom;
  const X = (ms) => L + (rtl ? 1 - (ms - o.start) / (o.end - o.start) : (ms - o.start) / (o.end - o.start)) * pw;
  const ticks = o.ticks || niceTicks(o.min, o.max);
  const min = Math.min(o.min, ticks[0]), max = Math.max(o.max, ticks.at(-1));
  const Y = (v) => top + (1 - (v - min) / Math.max(1e-6, max - min)) * ph;
  const id = 'wc' + Math.random().toString(36).slice(2, 7);
  let g = '', defs = '';
  for (const v of ticks) g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="yl" x="${rtl ? L - 6 : W - R + 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="${rtl ? 'end' : 'start'}">${esc(o.fmtY(v))}</text>`;
  for (let k = 0; k <= 4; k++) {
    const ms = o.start + (k * (o.end - o.start)) / 4, x = X(ms);
    g += `<line class="gv" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${top}" y2="${Hh - bottom}"/>`;
    if (k < 4) g += `<text class="xl" x="${(x + (rtl ? -4 : 4)).toFixed(1)}" y="${Hh - 6}" text-anchor="${rtl ? 'end' : 'start'}">${esc(o.hourLabel(ms))}</text>`;
  }
  // today: the hours already gone are dimmed
  const nowIn = o.now && o.now > o.start && o.now < o.end;
  const xn = nowIn ? X(o.now) : null;
  if (nowIn) defs += `<clipPath id="${id}f"><rect x="${rtl ? 0 : xn}" y="0" width="${rtl ? xn : W - xn}" height="${Hh}"/></clipPath><clipPath id="${id}p"><rect x="${rtl ? xn : 0}" y="0" width="${rtl ? W - xn : xn}" height="${Hh}"/></clipPath>`;
  const twice = (body) => (nowIn ? `<g clip-path="url(#${id}p)" class="past">${body}</g><g clip-path="url(#${id}f)">${body}</g>` : body);
  for (const b of o.bars || []) {
    const bw = Math.max(3, (pw / Math.max(24, o.times.length)) * 0.62);
    let body = '';
    o.times.forEach((ms, i) => {
      const v = b.v[i];
      if (v == null || v <= 0) return;
      const x = X(ms + H / 2), y = Y(Math.min(max, v));
      body += `<rect x="${(x - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, Y(min) - y).toFixed(1)}" rx="${Math.min(3, bw / 2).toFixed(1)}" fill="${b.colorOf ? b.colorOf(v) : b.color}"/>`;
    });
    g += twice(`<g class="bars">${body}</g>`);
  }
  (o.lines || []).forEach((ln, li) => {
    const pts = o.times.map((ms, i) => (ln.v[i] == null ? null : [X(ms), Y(ln.v[i])])).filter(Boolean);
    if (pts.length < 2) return;
    const d = smooth(pts);
    let stroke = ln.stroke || '#fff';
    if (ln.grad) {
      const gid = `${id}g${li}`;
      defs += `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${Y(max)}" y2="${Y(min)}">${ln.grad.map(([v, c]) => [Math.min(1, Math.max(0, (max - v) / Math.max(1e-6, max - min))), c]).sort((a, b) => a[0] - b[0]).map(([f, c]) => `<stop offset="${f.toFixed(3)}" stop-color="${c}"/>`).join('')}</linearGradient>`;
      stroke = `url(#${gid})`;
    }
    let body = '';
    if (ln.fill) {
      const fid = `${id}a${li}`;
      defs += `<linearGradient id="${fid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${ln.fill}" stop-opacity=".4"/><stop offset="1" stop-color="${ln.fill}" stop-opacity="0"/></linearGradient>`;
      body += `<path d="${d}L${pts.at(-1)[0].toFixed(1)} ${Y(min)}L${pts[0][0].toFixed(1)} ${Y(min)}Z" fill="url(#${fid})"/>`;
    }
    body += `<path d="${d}" class="ln${ln.dash ? ' dash' : ''}" stroke="${stroke}"/>`;
    g += ln.dim ? `<g class="ghost">${body}</g>` : twice(body);
  });
  for (const m of o.marks || []) {
    const ln = o.lines[0], x = X(o.times[m.i]), y = Y(ln.v[m.i]);
    g += `<g class="mk"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/><text x="${x.toFixed(1)}" y="${(m.below ? y + 17 : y - 9).toFixed(1)}" text-anchor="middle">${esc(m.label)}</text></g>`;
  }
  if (o.icons) g += o.icons.map((ic) => `<g transform="translate(${(X(ic.t) - 9).toFixed(1)} 4)">${ic.html}</g>`).join('');
  if (nowIn) {
    g += `<line class="nowl" x1="${xn.toFixed(1)}" x2="${xn.toFixed(1)}" y1="${top}" y2="${Hh - bottom}"/>`;
    const ln = o.lines?.[0];
    if (ln) {
      const i = o.times.findIndex((ms) => ms + H > o.now), a = ln.v[i], b = ln.v[Math.min(i + 1, ln.v.length - 1)];
      if (a != null) {
        const f = (o.now - o.times[i]) / H, v = b == null ? a : a + (b - a) * f;
        g += `<circle class="nowd" cx="${xn.toFixed(1)}" cy="${Y(v).toFixed(1)}" r="5.5"/>`;
      }
    }
  }
  g += `<g class="scrub" visibility="hidden"><line x1="0" x2="0" y1="${top}" y2="${Hh - bottom}"/><circle r="5.5" cx="0" cy="0"/></g><rect class="hit" x="${L}" y="0" width="${pw}" height="${Hh}" fill="transparent"/>`;
  return { svg: `<svg class="wxc" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="xMidYMid meet" data-l="${L}" data-pw="${pw}" role="img" style="direction:ltr">${defs ? `<defs>${defs}</defs>` : ''}${g}</svg>`, X, Y };
}

/** Pointer scrubbing over a chart: shows a line (and a dot on the first line) and reports the hour index, or null. */
export function bindScrub(host, o, ch, onHour) {
  const svg = host.querySelector('svg.wxc');
  if (!svg) return;
  const grp = svg.querySelector('.scrub'), line = grp.querySelector('line'), dot = grp.querySelector('circle'), hit = svg.querySelector('.hit');
  const pick = (e) => {
    const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * 640;
    let f = (x - +svg.dataset.l) / +svg.dataset.pw;
    if (isRtl()) f = 1 - f;
    const ms = o.start + Math.min(0.999, Math.max(0, f)) * (o.end - o.start);
    const i = Math.max(0, Math.min(o.times.length - 1, Math.floor((ms - o.times[0]) / H)));
    const cx = ch.X(o.times[i] + (o.bars?.length && !o.lines?.length ? H / 2 : 0)).toFixed(1);
    line.setAttribute('x1', cx);
    line.setAttribute('x2', cx);
    const v = o.lines?.[0]?.v[i];
    if (v != null) {
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', ch.Y(v).toFixed(1));
      dot.setAttribute('visibility', 'visible');
    } else dot.setAttribute('visibility', 'hidden');
    grp.setAttribute('visibility', 'visible');
    onHour(i);
  };
  hit.addEventListener('pointermove', pick);
  hit.addEventListener('pointerdown', pick);
  hit.addEventListener('pointerleave', () => {
    grp.setAttribute('visibility', 'hidden');
    onHour(null);
  });
}
