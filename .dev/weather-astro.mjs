// Plain-node test of the Weather app's on-device astronomy (js/weather/astro.js): sunrise/sunset against published
// times, twilight order, polar night, sun altitude, Moon phase, next full/new moon, moonrise/moonset and the lit path.
// usage: node .dev/weather-astro.mjs   (exit 1 on failure)
import { sunTimes, sunAltitude, moonPhase, nextPhase, moonTimes, phaseIndex, moonLitPath } from '../js/weather/astro.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok', m); } else { fail++; console.log('FAIL', m); } };
const U = (s) => Date.parse(s);
const MIN = 6e4, H = 36e5;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const hm = (ms) => new Date(ms).toISOString().slice(11, 16);

// published sunrise/sunset (timeanddate.com), within 5 minutes
const SUN = [
  ['London, June solstice', 51.5074, -0.1278, '2024-06-21T12:00:00Z', '2024-06-21T03:43:00Z', '2024-06-21T20:21:00Z'],
  ['New York, December solstice', 40.7128, -74.006, '2024-12-21T17:00:00Z', '2024-12-21T12:17:00Z', '2024-12-21T21:32:00Z'],
  ['Sydney, December solstice', -33.8688, 151.2093, '2024-12-21T01:00:00Z', '2024-12-20T18:41:00Z', '2024-12-21T09:05:00Z'],
  ['Cairo, March equinox', 30.0444, 31.2357, '2024-03-20T10:00:00Z', '2024-03-20T03:59:00Z', '2024-03-20T16:06:00Z'],
];
for (const [name, lat, lon, noon, rise, set] of SUN) {
  const s = sunTimes(U(noon), lat, lon);
  ok(near(s.sunrise, U(rise), 5 * MIN), `${name}: sunrise ${hm(s.sunrise)} UTC (published ${rise.slice(11, 16)})`);
  ok(near(s.sunset, U(set), 5 * MIN), `${name}: sunset ${hm(s.sunset)} UTC (published ${set.slice(11, 16)})`);
  ok(s.dawn < s.sunrise && s.sunrise < s.noon && s.noon < s.sunset && s.sunset < s.dusk, `${name}: dawn < sunrise < noon < sunset < dusk`);
  ok(s.sunrise - s.dawn > 20 * MIN && s.sunrise - s.dawn < 90 * MIN, `${name}: civil twilight lasts ${Math.round((s.sunrise - s.dawn) / MIN)} min`);
  ok(Math.abs(sunAltitude(s.sunrise, lat, lon) + 0.833) < 0.6, `${name}: the sun is at the horizon at sunrise (${sunAltitude(s.sunrise, lat, lon).toFixed(2)}°)`);
}
const tromso = sunTimes(U('2024-12-21T11:00:00Z'), 69.6492, 18.9553);
ok(Number.isNaN(tromso.sunrise) && Number.isNaN(tromso.sunset), 'Tromsø in December: polar night, no sunrise or sunset');
ok(!Number.isNaN(tromso.dawn), 'Tromsø in December: still a civil twilight');
const midsummer = sunTimes(U('2024-06-21T11:00:00Z'), 69.6492, 18.9553);
ok(Number.isNaN(midsummer.sunset), 'Tromsø in June: midnight sun, no sunset');
ok(sunAltitude(U('2024-03-20T12:07:00Z'), 0, 0) > 85, 'equator at the equinox: the sun is almost overhead at noon');
ok(sunAltitude(U('2024-06-21T00:00:00Z'), 51.5, 0) < -10, 'London at midnight: the sun is well below the horizon');

// Moon: published full and new moons (UTC), within 90 minutes for this low-precision model
const FULL = ['2024-01-25T17:54:00Z', '2024-08-19T18:26:00Z', '2025-10-07T03:47:00Z', '2026-01-03T10:03:00Z'];
const NEW = ['2024-02-09T22:59:00Z', '2024-10-02T18:49:00Z', '2025-10-21T12:25:00Z', '2026-01-18T19:52:00Z'];
for (const f of FULL) {
  const got = nextPhase(U(f) - 5 * 864e5, 0.5);
  ok(got && near(got, U(f), 1.5 * H), `next full moon ${new Date(got).toISOString().slice(0, 16)} (published ${f.slice(0, 16)})`);
  const p = moonPhase(U(f));
  ok(p.fraction > 0.98 && phaseIndex(p.phase) === 4, `at full moon ${f.slice(0, 10)}: ${(p.fraction * 100).toFixed(1)}% lit, phase index 4`);
}
for (const n of NEW) {
  const got = nextPhase(U(n) - 9 * 864e5, 0);
  ok(got && near(got, U(n), 1.5 * H), `next new moon ${new Date(got).toISOString().slice(0, 16)} (published ${n.slice(0, 16)})`);
  const p = moonPhase(U(n));
  ok(p.fraction < 0.02 && phaseIndex(p.phase) === 0, `at new moon ${n.slice(0, 10)}: ${(p.fraction * 100).toFixed(1)}% lit, phase index 0`);
}
// first quarter 2024-01-18 03:52 UTC: half lit and waxing
const fq = moonPhase(U('2024-01-18T03:52:00Z'));
ok(Math.abs(fq.fraction - 0.5) < 0.05 && fq.phase < 0.5 && phaseIndex(fq.phase) === 2, `first quarter: ${(fq.fraction * 100).toFixed(0)}% lit, waxing, index 2`);
const lq = moonPhase(U('2024-02-02T23:18:00Z'));
ok(Math.abs(lq.fraction - 0.5) < 0.05 && lq.phase > 0.5 && phaseIndex(lq.phase) === 6, `last quarter: ${(lq.fraction * 100).toFixed(0)}% lit, waning, index 6`);
ok(moonPhase(U('2024-01-25T17:54:00Z')).distance > 356000 && moonPhase(U('2024-01-25T17:54:00Z')).distance < 407000, 'Moon distance is within perigee/apogee');
ok([0.01, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.99].map(phaseIndex).join() === '0,1,2,3,4,5,6,7,0', 'phaseIndex maps the cycle to 8 names');

// moonrise/moonset: around full moon the Moon rises near sunset and sets near sunrise
const lat = 51.5074, lon = -0.1278, mid = U('2024-01-25T00:00:00Z');
const mt = moonTimes(mid, lat, lon), st = sunTimes(U('2024-01-25T12:00:00Z'), lat, lon);
ok(mt.rise && near(mt.rise, st.sunset, 2.5 * H), `full moon in London rises ${hm(mt.rise)} UTC, near sunset ${hm(st.sunset)}`);
ok(mt.set && near(mt.set, st.sunrise, 2.5 * H), `and sets ${hm(mt.set)} UTC, near sunrise ${hm(st.sunrise)}`);
ok(!mt.up && !mt.down, 'it both rises and sets that day');
const nm = moonTimes(U('2024-02-09T00:00:00Z'), lat, lon), sn = sunTimes(U('2024-02-09T12:00:00Z'), lat, lon);
ok(nm.rise && near(nm.rise, sn.sunrise, 2.5 * H), `new moon rises with the sun (${hm(nm.rise)} vs ${hm(sn.sunrise)} UTC)`);
const polar = moonTimes(U('2024-12-15T00:00:00Z'), 78.22, 15.65);
ok(polar.up || polar.down || polar.rise != null || polar.set != null, 'Svalbard: up/down flags or times, never nothing');

// the lit part as an SVG path
const path = moonLitPath(0.25, 0.5, 40, 50);
ok(/^M50 10A40 40 0 0 1 50 90A[\d.]+ 40 0 0 [01] 50 10Z$/.test(path), 'moonLitPath: a closed path from the top to the bottom limb: ' + path);
ok(moonLitPath(0.25, 0.5, 40, 50) !== moonLitPath(0.25, 0.5, 40, 50, true), 'southern hemisphere mirrors the lit side');
ok(moonLitPath(0.1, 0.1, 40, 50).includes('A31.') || moonLitPath(0.1, 0.1, 40, 50).includes('A32.'), 'a 10 % crescent has a wide inner arc');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
