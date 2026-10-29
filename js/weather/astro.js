// Sun and Moon positions, rise/set times and the Moon's phase, computed on the device (standard low-precision
// formulas from Meeus' "Astronomical Algorithms", accurate to a few minutes). Ported from Liquid Tab's
// weather-astro.js. Pure: no DOM, so the service worker and plain-node tests can import it.
const PI = Math.PI, rad = PI / 180, DAY = 864e5, J1970 = 2440588, J2000 = 2451545, E = rad * 23.4397;
const { sin, cos, tan, asin, acos, atan2, sqrt, abs } = Math;

const toDays = (ms) => ms / DAY - 0.5 + J1970 - J2000;
const fromJulian = (j) => (j + 0.5 - J1970) * DAY;
const rightAscension = (l, b) => atan2(sin(l) * cos(E) - tan(b) * sin(E), cos(l));
const declination = (l, b) => asin(sin(b) * cos(E) + cos(b) * sin(E) * sin(l));
const altitude = (H, phi, dec) => asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const refraction = (h) => {
  h = Math.max(h, 0);
  return 0.0002967 / tan(h + 0.00312536 / (h + 0.08901179));
};
const solarAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
const eclipticLon = (M) => M + rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)) + rad * 102.9372 + PI;
function sunCoords(d) {
  const L = eclipticLon(solarAnomaly(d));
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

/** Sun altitude in degrees (0 = horizon) at a moment, for a place. */
export function sunAltitude(ms, lat, lon) {
  const d = toDays(ms), c = sunCoords(d), H = sidereal(d, rad * -lon) - c.ra;
  return altitude(H, rad * lat, c.dec) / rad;
}

/** Sunrise/sunset and civil twilight for the day around `ms`: { dawn, sunrise, noon, sunset, dusk } (ms; NaN when the sun never crosses). */
export function sunTimes(ms, lat, lon) {
  const lw = rad * -lon, phi = rad * lat, d = toDays(ms);
  const n = Math.round(d - 0.0009 - lw / (2 * PI));
  const ds = 0.0009 + lw / (2 * PI) + n;
  const M = solarAnomaly(ds), L = eclipticLon(M), dec = declination(L, 0);
  const Jnoon = J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
  const at = (h) => {
    const w = acos((sin(h * rad) - sin(phi) * sin(dec)) / (cos(phi) * cos(dec)));
    const Jset = J2000 + 0.0009 + (w + lw) / (2 * PI) + n + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
    return [fromJulian(Jnoon - (Jset - Jnoon)), fromJulian(Jset)];
  };
  const [sunrise, sunset] = at(-0.833), [dawn, dusk] = at(-6);
  return { dawn, sunrise, noon: fromJulian(Jnoon), sunset, dusk };
}

function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
  // the largest periodic terms after the equation of the centre (evection, variation, annual equation…): without
  // them full and new moons come out up to six hours early or late
  const D = rad * (297.8502 + 12.190749 * d), Ms = solarAnomaly(d);
  const l = L + rad * (6.289 * sin(M) + 1.274 * sin(2 * D - M) + 0.658 * sin(2 * D) + 0.214 * sin(2 * M) - 0.186 * sin(Ms) - 0.114 * sin(2 * F));
  const b = rad * (5.128 * sin(F) + 0.281 * sin(M + F) + 0.278 * sin(M - F) + 0.173 * sin(2 * D - F));
  return { l, ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * cos(M) - 3699 * cos(2 * D - M) - 2956 * cos(2 * D) };
}
function moonAltitude(ms, lat, lon) {
  const d = toDays(ms), c = moonCoords(d), H = sidereal(d, rad * -lon) - c.ra;
  const h = altitude(H, rad * lat, c.dec);
  return h + refraction(h);
}

/** { fraction (lit share 0…1), phase (0 new → .5 full → 1 new), distance (km) } */
export function moonPhase(ms) {
  const d = toDays(ms), Ls = eclipticLon(solarAnomaly(d)), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
  const phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
  const inc = atan2(sdist * sin(phi), m.dist - sdist * cos(phi));
  // the phase is the Moon's elongation in ecliptic longitude (new moon = conjunction, as almanacs define it); the
  // bright limb's position angle would flip at opposition in right ascension instead, hours off
  const elong = (((m.l - Ls) % (2 * PI)) + 2 * PI) % (2 * PI);
  return { fraction: (1 + cos(inc)) / 2, phase: elong / (2 * PI), distance: m.dist };
}

/** Moonrise and moonset during the 24 hours from `startMs` (the place's local midnight): { rise, set, up, down }. */
export function moonTimes(startMs, lat, lon) {
  const hc = 0.133 * rad, alt = (h) => moonAltitude(startMs + h * 36e5, lat, lon) - hc;
  let h0 = alt(0), rise, set, ye = 0;
  for (let i = 1; i <= 24; i += 2) {
    const h1 = alt(i), h2 = alt(i + 1);
    const a = (h0 + h2) / 2 - h1, b = (h2 - h0) / 2, xe = -b / (2 * a);
    ye = (a * xe + b) * xe + h1;
    const disc = b * b - 4 * a * h1;
    let roots = 0, x1 = 0, x2 = 0;
    if (disc >= 0) {
      const dx = sqrt(disc) / (abs(a) * 2);
      x1 = xe - dx;
      x2 = xe + dx;
      if (abs(x1) <= 1) roots++;
      if (abs(x2) <= 1) roots++;
      if (x1 < -1) x1 = x2;
    }
    if (roots === 1) {
      if (h0 < 0) rise = i + x1;
      else set = i + x1;
    } else if (roots === 2) {
      rise = i + (ye < 0 ? x2 : x1);
      set = i + (ye < 0 ? x1 : x2);
    }
    if (rise != null && set != null) break;
    h0 = h2;
  }
  return {
    rise: rise != null ? startMs + rise * 36e5 : null, set: set != null ? startMs + set * 36e5 : null,
    up: rise == null && set == null && ye > 0, down: rise == null && set == null && ye <= 0,
  };
}

/** The next moment (after `ms`) the Moon is full (target .5) or new (target 0). */
export function nextPhase(ms, target) {
  const f = (x) => {
    const p = moonPhase(x).phase;
    return target === 0.5 ? p - 0.5 : (p < 0.5 ? p + 1 : p) - 1;
  };
  let a = ms, fa = f(a);
  for (let i = 1; i <= 31 * 4; i++) {
    const b = ms + i * 6 * 36e5, fb = f(b);
    // a sign change from − to + (and not the wrap-around jump of the other phase)
    if (fa < 0 && fb >= 0 && fb - fa < 0.25) {
      let lo = a, hi = b;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (f(mid) < 0) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    a = b;
    fa = fb;
  }
  return null;
}

/** 0…7: New, Waxing crescent, First quarter, Waxing gibbous, Full, Waning gibbous, Last quarter, Waning crescent. */
export function phaseIndex(p) {
  if (p < 0.0339 || p >= 0.9661) return 0;
  if (p < 0.2161) return 1;
  if (p < 0.2839) return 2;
  if (p < 0.4661) return 3;
  if (p < 0.5339) return 4;
  if (p < 0.7161) return 5;
  if (p < 0.7839) return 6;
  return 7;
}

/** The lit part of a Moon of radius r centred at (c, c), as an SVG path. South of the equator it is mirrored. */
export function moonLitPath(phase, fraction, r, c = r, south = false) {
  const waxing = phase < 0.5 !== south;
  const rx = Math.max(0.01, r * abs(2 * fraction - 1));
  const top = `${c} ${c - r}`, bottom = `${c} ${c + r}`;
  const outer = waxing ? 1 : 0; // the lit limb: right when waxing
  const inner = fraction < 0.5 === waxing ? 0 : 1; // a crescent bulges toward the lit limb
  return `M${top}A${r} ${r} 0 0 ${outer} ${bottom}A${rx.toFixed(2)} ${r} 0 0 ${inner} ${top}Z`;
}
