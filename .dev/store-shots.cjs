// Chrome Web Store screenshots: seeds realistic sample data, then captures the shell and every app at 1280×800 into
// store/screens (then .dev/store-compose.cjs builds the captioned store images from them).
// usage: OUT=store/screens W=1280 H=800 .dev/run.sh .dev/store-shots.cjs      (SCENES=lock,home,… runs only those)
// The page's clock reads 10:10 tomorrow in London at the start of every page load: tomorrow, so nothing the pages
// schedule with chrome.alarms is already due in real time and rings in a shot (every app's notifications are also
// turned off, as the service worker still runs on real time). Every name, place, pass, photo and recording is made up
// here and stays in this throwaway profile. The scenes take about 12 minutes; run them in two or three groups.
process.env.TZ = 'Europe/London';
const fs = require('fs'), path = require('path');
const ONLY = (process.env.SCENES || '').split(',').filter(Boolean);

module.exports = async (ctx) => {
  const { page, boot, sleep, mod, openApp, ok } = ctx;
  const OUT = path.resolve(process.env.OUT || path.join(__dirname, 'shots/store'));
  fs.mkdirSync(OUT, { recursive: true });
  const shot = async (name) => { await sleep(500); await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); };
  await page.emulateTimezone('Europe/London');

  // ---------------------------------------------------------------- a fake clock that starts at `target` on every load
  const pad = (n) => String(n).padStart(2, '0');
  const day0 = new Date(); day0.setDate(day0.getDate() + 1); day0.setHours(0, 0, 0, 0);
  const at = (o, h = 0, m = 0) => { const d = new Date(day0); d.setDate(d.getDate() + o); d.setHours(h, m, 0, 0); return +d; };
  const T = at(0, 10, 10), H = 36e5, D = 864e5, MIN = 6e4;
  const dk = (o = 0) => { const d = new Date(at(o)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const md = (o = 0) => dk(o).slice(5);
  let clockScript = null;
  const setClock = async (ms) => {
    if (clockScript) await page.removeScriptToEvaluateOnNewDocument(clockScript.identifier);
    clockScript = await page.evaluateOnNewDocument((target) => {
      if (window.__fake) return;
      window.__fake = 1;
      const RD = Date, rn = RD.now.bind(RD), off = target - rn();
      class FakeDate extends RD { constructor(...a) { if (a.length) super(...a); else super(rn() + off); } static now() { return rn() + off; } }
      window.Date = FakeDate;
    }, ms);
  };
  await setClock(T);

  // ---------------------------------------------------------------- sample data
  const W = (id, widget, size, config = {}) => ({ id, type: 'widget', widget, size, config });
  const A = (app) => ({ id: 'a-' + app, type: 'app', app });
  const notes = [
    { id: 'n1', title: 'Weekend in Lisbon', body: '<h2>Packing</h2><ul class="checklist"><li data-checked="true">Passport</li><li data-checked="true">Chargers</li><li>Sunglasses</li><li>Camera</li></ul><h2>Places to see</h2><ul><li>Belém Tower</li><li>LX Factory</li><li>Alfama at sunset</li></ul><p>Try <b>pastéis de nata</b> near the river.</p>', color: 'yellow', pinned: true, created: T - 3 * D, updated: T - 20 * MIN, tags: ['travel'] },
    { id: 'n2', title: 'Groceries', body: '<ul class="checklist"><li>Oat milk</li><li>Avocados</li><li data-checked="true">Sourdough</li><li>Coffee beans</li></ul>', color: 'green', pinned: false, created: T - 2 * D, updated: T - 2 * H },
    { id: 'n3', title: 'Design review', body: '<p>Tighten the onboarding copy</p><p>New icon set for Settings</p><p>Ship the beta on Friday</p>', color: 'blue', pinned: false, created: T - 4 * D, updated: T - 5 * H, tags: ['work'] },
    { id: 'n4', title: 'Book club — November', body: '<p>Discussion questions for Thursday</p>', color: 'purple', pinned: false, created: T - 5 * D, updated: T - D - 3 * H },
    { id: 'n5', title: 'Gift ideas', body: '<p>Headphones for Sam</p><p>Pottery class for Mom</p>', color: 'pink', pinned: false, created: T - 9 * D, updated: T - 3 * D },
    { id: 'n6', title: 'Recipes to try', body: '<p>Shakshuka</p><p>Miso glazed salmon</p><p>Lemon olive-oil cake</p>', color: 'orange', pinned: false, created: T - 20 * D, updated: T - 6 * D },
  ];
  const reminderCats = { list: [
    { id: 'rem', name: '', color: '#3e7bff', icon: 'list' },
    { id: 'work', name: 'Work', color: '#f59e0b', icon: 'work' },
    { id: 'home', name: 'Home', color: '#22a356', icon: 'home' },
    { id: 'trip', name: 'Lisbon trip', color: '#a855f7', icon: 'flight' },
  ] };
  const R = (id, title, due, extra = {}) => ({ id, title, notes: '', due, done: false, priority: false, created: T - 3 * D, completedAt: null, ...extra });
  const reminders = [
    R('r1', 'Send the quarterly report', at(0, 11), { cat: 'work', priority: true }),
    R('r2', 'Water the plants', at(0, 18), { cat: 'home' }),
    R('r3', 'Book a table for Friday', at(0, 17, 30)),
    R('r4', 'Prepare slides for Monday', at(3, 14), { cat: 'work', subs: [{ id: 's1', title: 'Outline', done: true }, { id: 's2', title: 'Charts', done: false }] }),
    R('r5', 'Check in for the flight', at(2, 8), { cat: 'trip', priority: true }),
    R('r6', 'Buy a travel adapter', at(1, 12), { cat: 'trip' }),
    R('r7', 'Call the dentist', null),
    R('r8', 'Pay the electricity bill', at(0, 9), { cat: 'home', done: true, completedAt: at(0, 8, 40) }),
    R('r9', 'Reply to Sam about Lisbon', null, { done: true, completedAt: at(0, 9, 20) }),
    R('r10', 'Renew gym membership', at(5, 10), { cat: 'home', repeat: { f: 'y' } }),
  ];
  const E = (id, title, start, end, color, extra = {}) => ({ id, title, start, end, allDay: false, color, notes: '', alert: 'none', ...extra });
  // weekly events from four weeks back fill the month; today is a Friday-like busy day
  const events = [
    E('e1', 'Team stand-up', at(-32, 9, 30), at(-32, 9, 45), '#3e7bff', { repeat: { freq: 'week', interval: 1 } }),
    E('e2', 'Gym', at(-31, 7), at(-31, 8), '#14b8a6', { repeat: { freq: 'week', interval: 1 }, place: 'Pulse Fitness' }),
    E('e3', '1:1 with Alex', at(-29, 15), at(-29, 15, 30), '#3e7bff', { repeat: { freq: 'week', interval: 1 } }),
    E('e4', 'Yoga', at(-28, 18), at(-28, 19), '#14b8a6', { repeat: { freq: 'week', interval: 1 } }),
    E('e5', 'Design review', at(0, 11), at(0, 12), '#3e7bff', { place: 'Room 4' }),
    E('e6', 'Lunch with Sara', at(0, 12, 30), at(0, 13, 30), '#f97316', { place: 'Borough Market' }),
    E('e7', 'Book club', at(-26, 19), at(-26, 20, 30), '#a855f7'),
    E('e8', 'Dinner with Sam & Lea', at(-20, 19, 30), at(-20, 22), '#f97316'),
    E('e9', 'Dentist', at(-16, 8, 30), at(-16, 9, 15), '#f59e0b'),
    E('e10', 'Concert', at(-12, 20), at(-12, 22, 30), '#e2589c'),
    E('e11', 'Haircut', at(-9, 17), at(-9, 17, 45), '#f59e0b'),
    E('e12', 'Brunch', at(-5, 11), at(-5, 12, 30), '#f97316'),
    E('e13', 'Coffee with Jordan', at(-2, 10), at(-2, 10, 45), '#f97316'),
    E('e14', 'Farmers market', at(1, 9), at(1, 10, 30), '#22a356'),
    E('e15', 'Movie night', at(1, 20), at(1, 22), '#e2589c'),
    E('e16', 'Product launch', at(3, 10), at(3, 11, 30), '#3e7bff'),
    E('e17', 'Flight to Lisbon', at(4, 7, 15), at(4, 9, 40), '#a855f7'),
    { id: 'e18', title: 'Lisbon', start: at(4), end: at(7) - MIN, allDay: true, color: '#a855f7', notes: '', alert: 'none' },
    E('e19', 'Sprint planning', at(-22, 13), at(-22, 14, 30), '#3e7bff'),
  ];
  const alarms = [
    { id: 'al1', time: '06:45', days: [1, 2, 3, 4, 5], label: 'Work', enabled: true },
    { id: 'al2', time: '08:30', days: [0, 6], label: 'Weekend', enabled: true },
    { id: 'al3', time: '14:00', days: [], label: 'Power nap', enabled: false },
  ];
  const clocks = [{ id: 'c1', tz: 'America/New_York', city: 'New York' }, { id: 'c2', tz: 'Asia/Seoul', city: 'Seoul' }, { id: 'c3', tz: 'Asia/Dubai', city: 'Dubai' }, { id: 'c4', tz: 'America/Los_Angeles', city: 'Los Angeles' }];
  const timers = [{ id: 't1', label: 'Pasta', duration: 10 * 60e3, endsAt: T + 7 * MIN + 42e3, remaining: 7 * MIN + 42e3, running: true }];
  const notifications = [
    { id: 'nt1', app: 'calendar', title: 'Design review', body: '11:00 – 12:00 · Room 4', time: T - 12 * MIN, read: false },
    { id: 'nt2', app: 'reminder', title: 'Send the quarterly report', body: 'Today 11:00', time: T - 40 * MIN, read: false },
    { id: 'nt3', app: 'health', title: 'Time for your medication', body: 'Vitamin D · 1 tablet', time: T - 70 * MIN, read: false },
    { id: 'nt4', app: 'wallet', title: 'Bill due in 3 days', body: 'Streaming · £10.99', time: T - 3 * H, read: false },
  ];
  const focusLog = [{ start: at(0, 8, 15), end: at(0, 9, 5) }, { start: at(-1, 10), end: at(-1, 11, 30) }, { start: at(-2, 14), end: at(-2, 15) }];
  const health = {
    profile: { name: 'Alex Morgan' }, units: { weight: 'kg', height: 'cm', water: 'ml' },
    meds: [
      { id: 'med-a', name: 'Vitamin D', type: 'tablet', strength: '1000', unit: 'IU', shape: 'round', c1: '#ffd60a', bg: '#fff09a', sched: { kind: 'daily', times: [{ t: '09:00', n: 1 }] }, start: dk(-30) },
      { id: 'med-b', name: 'Omega-3', type: 'capsule', shape: 'capsule', c1: '#f5a524', c2: '#ffd27a', bg: '#ffe7b0', sched: { kind: 'daily', times: [{ t: '09:00', n: 1 }, { t: '21:00', n: 1 }] }, start: dk(-30) },
      { id: 'med-c', name: 'Allergy relief', type: 'tablet', shape: 'oval', c1: '#ffffff', bg: '#a9d9ff', sched: { kind: 'asNeeded' }, start: dk(-30) },
    ],
    medLog: [], water: [], sleep: [], mind: [], body: [], mindful: [],
    cycle: { days: {} },
  };
  for (let i = 0; i <= 20; i++) {
    if (i) health.water.push({ id: 'w' + i, at: at(-i, 13), ml: 1500 + ((i * 370) % 900) });
    if (i) health.sleep.push({ id: 's' + i, start: at(-i - 1, 23, (i * 13) % 50), end: at(-i, 6 + (i % 2), (i * 17) % 50) });
    if (i && i % 3 === 0) health.mind.push({ id: 'm' + i, at: at(-i, 20), valence: [1.6, 0.8, 2.2, -0.4, 1.2, 1.9, 0.5][i % 7], labels: ['Calm'], areas: ['Work'] });
    if (i % 5 === 0) health.body.push({ id: 'b' + i, at: at(-i, 7, 30), kind: 'weight', value: 71.4 + i * 0.04 });
    if (i && i <= 14) { health.medLog.push({ id: `l${i}a`, med: 'med-a', slot: `${dk(-i)}T09:00`, status: 'taken', n: 1, at: at(-i, 9, 4) }, { id: `l${i}b`, med: 'med-b', slot: `${dk(-i)}T09:00`, status: 'taken', n: 1, at: at(-i, 9, 4) }); }
  }
  health.water.push({ id: 'w0a', at: at(0, 7, 40), ml: 250 }, { id: 'w0b', at: at(0, 9, 10), ml: 500 });
  health.sleep.push({ id: 's0', start: at(-1, 23, 5), end: at(0, 6, 50) });
  health.medLog.push({ id: 'l0a', med: 'med-a', slot: `${dk(0)}T09:00`, status: 'taken', n: 1, at: at(0, 9, 2) });
  health.body.push({ id: 'bh', at: at(-60, 8), kind: 'height', value: 176 });
  health.mind.push({ id: 'm0', at: at(0, 8), valence: 1.8, labels: ['Happy', 'Grateful'], areas: ['Fitness'] });
  for (const start of [37, 9]) for (let i = 0; i < 5; i++) health.cycle.days[dk(-(start - i))] = { flow: i < 2 ? 'heavy' : 'medium' };
  const healthAct = { v: 1, days: { [dk(0)]: { breakH: [8, 9], activeH: Array(24).fill(0) } } };
  const F = (l, v) => ({ l, v });
  const wallet = {
    v: 1,
    passes: [
      { id: 'p-flight', kind: 'boarding', name: 'Skyline Air', bg: '#0b3d91', transit: 'air', quick: true, header: [F('Flight', 'SK 482'), F('Gate', 'B12')], primary: [F('London', 'LHR'), F('Lisbon', 'LIS')], secondary: [F('Passenger', 'MORGAN/ALEX')], aux: [F('Seat', '14A'), F('Boarding', '06:35')], back: [F('Confirmation', 'K7Q2ZP')], code: { type: 'pdf417', msg: 'M1MORGAN/ALEX EK7Q2ZP LHRLISSK 0482 304Y014A0001 100', alt: '' }, date: `${dk(4)}T07:15`, at: T - 4 * D },
      { id: 'p-gym', kind: 'member', name: 'Pulse Fitness', bg: '#1c1c22', quick: true, header: [F('Points', '1,240')], primary: [F('Member', 'Alex Morgan')], secondary: [F('Member number', '48213'), F('Level', 'Gold')], aux: [], back: [], code: { type: 'qr', msg: 'PULSE-48213', alt: '48213' }, at: T - 5 * D },
      { id: 'p-show', kind: 'ticket', name: 'City Arena', bg: '#7a3ff2', header: [F('Section', 'A3')], primary: [F('Event', 'Jazz Night')], secondary: [F('Venue', 'City Arena')], aux: [F('Row', '12'), F('Seat', '34')], back: [], code: { type: 'qr', msg: 'ARENA-7GQ2-11A', alt: '7GQ2 11A' }, date: `${dk(9)}T19:30`, at: T - 3 * D },
      { id: 'p-coupon', kind: 'coupon', name: 'Corner Café', bg: '#ff7a2f', quick: true, header: [], primary: [F('Offer', '20% off')], secondary: [], aux: [], back: [], code: { type: 'code128', msg: 'SAVE20NOW', alt: 'SAVE20NOW' }, expires: dk(20), at: T - 2 * D },
      { id: 'p-gift', kind: 'gift', name: 'Home & Co', bg: '#3e8bff', header: [], primary: [F('Balance', '£50.00')], secondary: [F('Card number', '6001 2345')], aux: [], back: [], code: { type: 'ean13', msg: '4006381333931', alt: '' }, at: T - D },
      { id: 'p-key', kind: 'key', name: 'Harbour Hotel', bg: '#147d6f', header: [], primary: [F('Room', '1204')], secondary: [], aux: [], back: [], code: { type: 'qr', msg: 'HARBOUR-1204', alt: '' }, date: `${dk(4)}T15:00`, expires: dk(7), at: T - D },
    ],
    subs: [
      { id: 's-tv', name: 'Streaming', amount: 10.99, cur: 'GBP', cycle: 'm', start: dk(3), cat: 'streaming', alert: 1, state: 'active', at: T },
      { id: 's-mu', name: 'Music plan', amount: 11.99, cur: 'GBP', cycle: 'm', start: dk(8), cat: 'music', alert: 1, state: 'active', at: T },
      { id: 's-cl', name: 'Cloud storage', amount: 2.49, cur: 'GBP', cycle: 'm', start: dk(12), cat: 'cloud', alert: 0, state: 'active', at: T },
      { id: 's-el', name: 'Electricity', amount: 68, cur: 'GBP', cycle: 'm', start: dk(6), cat: 'utilities', alert: 3, state: 'active', at: T },
      { id: 's-gy', name: 'Pulse Fitness', amount: 29, cur: 'GBP', cycle: 'm', start: dk(15), cat: 'fitness', alert: 1, state: 'active', at: T },
    ],
    spend: [
      [0, 3.4, 'Corner Café', 'food'], [0, 42.1, 'Green Grocer', 'food'], [-1, 18.4, 'Taxi', 'transport'], [-1, 64, 'Clothing', 'shopping'], [-2, 12.5, 'Lunch', 'food'],
      [-2, 15, 'Cinema', 'entertainment'], [-3, 27.3, 'Pharmacy', 'health'], [-3, 9.2, 'Bus pass', 'transport'], [-4, 120, 'Train tickets', 'travel'], [-4, 35, 'Haircut', 'services'],
      [-5, 6.75, 'Bakery', 'food'], [-6, 22, 'Fuel', 'transport'], [-8, 48, 'Home & Co', 'shopping'], [-9, 14, 'Books', 'entertainment'],
    ].map(([o, amt, mer, cat], i) => ({ id: 'x' + i, amt, cur: 'GBP', mer, cat, at: at(o, 8 + (i % 2), 15) })),
    budgets: { food: 300, shopping: 150, transport: 120 }, prefs: { cur: 'GBP', alertTime: '09:00' },
  };
  const C = (id, first, last, extra = {}) => ({ id, first, last, ...extra });
  const contacts = {
    v: 1,
    items: [
      C('c1', 'Sara', 'Ahmed', { company: 'Northwind', job: 'Product designer', phones: [{ l: 'mobile', v: '+44 7700 900134' }, { l: 'work', v: '+44 20 7946 0199' }], emails: [{ l: 'work', v: 'sara@example.com' }], addrs: [{ l: 'home', street: '12 Elm Row', city: 'London', zip: 'N1 7AA', country: 'United Kingdom' }], bday: `1992-${md(6)}`, av: { e: '🌸', c: '#f472b6' } }),
      C('c2', 'Omar', 'Haddad', { phones: [{ l: 'mobile', v: '+971 50 123 4567' }], bday: `--${md(2)}`, av: { e: '⚽', c: '#22c55e' } }),
      C('c3', 'Lina', 'Park', { emails: [{ l: 'work', v: 'lina@example.com' }], phones: [{ l: 'mobile', v: '+82 10 5555 0101' }] }),
      C('c4', 'Ben', 'Clark', { phones: [{ l: 'mobile', v: '+44 7700 900555' }], company: 'Clark & Sons' }),
      C('c5', 'Mia', 'Wong', { phones: [{ l: 'mobile', v: '+852 5555 1234' }], av: { e: '🎨', c: '#a78bfa' } }),
      C('c6', 'Daniel', 'Okafor', { phones: [{ l: 'mobile', v: '+44 7700 900777' }] }),
      C('c7', 'Emma', 'Rossi', { emails: [{ l: 'home', v: 'emma@example.com' }], av: { e: '🍕', c: '#fb923c' } }),
      C('c8', 'Hana', 'Kim', { phones: [{ l: 'mobile', v: '+82 10 5555 0202' }] }),
      C('c9', 'Jordan', 'Lee', { phones: [{ l: 'mobile', v: '+1 415 555 0134' }], av: { e: '☕', c: '#a16207' } }),
      C('c10', 'Yusuf', 'Karim', { phones: [{ l: 'home', v: '+44 20 7946 0000' }] }),
      C('c11', 'Chloé', 'Martin', { emails: [{ l: 'home', v: 'chloe@example.fr' }] }),
      C('c12', 'Noah', 'Fischer', { phones: [{ l: 'mobile', v: '+49 151 55550123' }] }),
      C('c13', 'Priya', 'Shah', { phones: [{ l: 'mobile', v: '+44 7700 900888' }], av: { e: '🎧', c: '#38bdf8' } }),
      C('c14', 'Tom', 'Baker', { phones: [{ l: 'mobile', v: '+44 7700 900222' }] }),
      C('me', 'Alex', 'Morgan', { phones: [{ l: 'mobile', v: '+44 7700 900000' }], emails: [{ l: 'home', v: 'alex@example.com' }] }),
    ],
    groups: [{ id: 'g1', name: 'Family', ids: ['c2', 'c10'] }, { id: 'g2', name: 'Work', ids: ['c1', 'c3', 'c9'] }],
    favs: ['c1', 'c2', 'c5', 'c9'], me: 'me', prefs: { sort: 'first', order: 'first', alert: 0, alertTime: '09:00' },
  };
  const weatherLoc = { name: 'London', lat: 51.51, lon: -0.13 };
  const forecast = ({ tz = 'Europe/London', off = 0, base = 11.5, amp = 4.5, now: cur = {} } = {}) => {
    const y0 = at(-1) / 1000, N = 11 * 24, hours = Array.from({ length: N }, (_, i) => y0 + i * 3600), hod = (i) => i % 24, now = Math.floor(T / 1000);
    return {
      timezone: tz, utc_offset_seconds: off,
      current: { ...cur, temperature_2m: cur.temperature_2m ?? 14.2, apparent_temperature: 12.8, relative_humidity_2m: 71, weather_code: 2, is_day: 1, precipitation: 0, cloud_cover: 35, wind_speed_10m: 14, wind_direction_10m: 225, wind_gusts_10m: 29, uv_index: 2.1, pressure_msl: 1016.2, visibility: 24100, dew_point_2m: 8.1 },
      hourly: { time: hours, temperature_2m: hours.map((_, i) => +(base + amp * Math.sin(((hod(i) - 9) / 24) * 2 * Math.PI)).toFixed(1)), apparent_temperature: hours.map(() => 12), weather_code: hours.map((_, i) => (i % 9 === 4 ? 61 : i % 5 === 0 ? 3 : 2)), is_day: hours.map((_, i) => +(hod(i) >= 7 && hod(i) < 17)), precipitation_probability: hours.map((_, i) => (i * 7) % 60), precipitation: hours.map(() => 0), relative_humidity_2m: hours.map(() => 70), dew_point_2m: hours.map(() => 8), uv_index: hours.map((_, i) => (hod(i) > 9 && hod(i) < 15 ? 2 : 0)), wind_speed_10m: hours.map(() => 14), wind_direction_10m: hours.map(() => 220), wind_gusts_10m: hours.map(() => 27), pressure_msl: hours.map(() => 1015), visibility: hours.map(() => 20000) },
      daily: { time: Array.from({ length: 11 }, (_, i) => y0 + i * 86400), weather_code: [61, 2, 3, 61, 80, 2, 1, 3, 61, 2, 1], temperature_2m_max: [15, 16, 14, 13, 12, 15, 16, 14, 12, 13, 15], temperature_2m_min: [9, 9, 8, 8, 7, 9, 10, 8, 6, 7, 8], precipitation_probability_max: [70, 10, 30, 70, 80, 20, 5, 40, 75, 15, 5], precipitation_sum: Array(11).fill(0), sunrise: Array.from({ length: 11 }, (_, i) => y0 + i * 86400 + 6.9 * 3600), sunset: Array.from({ length: 11 }, (_, i) => y0 + i * 86400 + 16.6 * 3600), daylight_duration: Array(11).fill(35000), uv_index_max: Array(11).fill(2), wind_speed_10m_max: Array(11).fill(22), wind_gusts_10m_max: Array(11).fill(38), wind_direction_10m_dominant: Array(11).fill(240) },
      minutely_15: { time: Array.from({ length: 9 }, (_, i) => now - 900 + i * 900), precipitation: Array(9).fill(0) },
    };
  };
  const air = { current: { us_aqi: 32, european_aqi: 21, pm2_5: 6, pm10: 12, ozone: 48, nitrogen_dioxide: 14, sulphur_dioxide: 2, carbon_monoxide: 170 } };

  const homePages = [
    [W('hw-weather', 'weather', 'm'), W('hw-clock', 'clock-analog', 's'), W('hw-cal', 'calendar-upcoming', 's'), A('health'), A('wallet'), A('music'), A('games'), A('journal'), A('contacts'), A('weather'), A('clock')],
    [A('canvas'), A('recorder'), A('interpreter'), A('routines'), A('wellbeing'), A('files'), A('calculator'), A('settings')],
  ];
  const dock = [A('notes'), A('calendar'), A('reminder'), A('store'), { id: 'a-drawer', type: 'app', app: 'drawer' }];
  const base = (extra = {}) => ({
    notes, reminders, reminderCats, events, alarms, clocks, timers: [], notifications, focusLog, health, healthAct, wallet, contacts,
    home: homePages, dock, left: [W('lw-brief', 'now-brief', 'm'), W('lw-stack', 'stack', 'm'), W('lw-rings', 'health-rings', 'm')],
    ...extra,
  });
  // every app muted, so nothing the service worker decides on its own (real time) pops up a banner in a shot
  await boot();
  const allApps = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApps().map((a) => a.id)));
  const SETTINGS = {
    location: weatherLoc, hour12: false, mutedApps: [...allApps, 'system', 'focus'], tempUnit: 'c',
    lockWidgets: ['weather', 'event', 'alarm', 'health-rings', 'battery'], wallpaper: { type: 'preset', id: 'bloom' },
  };
  // boot with the sample data, then the weather forecast (normalised by the app's own model, so nothing is fetched);
  // `max` lists the apps that open in full screen (their tablet layouts) instead of a pop-up window
  const start = async ({ settings = {}, data = {}, locked = false, hash = '', max = [], place = weatherLoc, fc = forecast() } = {}) => {
    const appWindows = Object.fromEntries(max.map((id) => [id, { max: true }]));
    await boot({ settings: { ...SETTINGS, location: place, ...settings }, data: base({ appWindows, ...data }), locked, hash });
    await page.evaluate(([fc, aq, loc]) => import('./js/weather/model.js').then((m) => m.normalize(fc, aq, loc)).then((c) => chrome.storage.local.set({ weather: { ...c, fetchedAt: Date.now() } })), [fc, air, place]);
    await sleep(900);
  };
  const go = (file, fn, ...args) => mod(file, fn, ...args).catch((e) => console.log('  (' + fn + ': ' + e.message + ')'));

  // ---------------------------------------------------------------- pictures painted in the page (no photos of anyone)
  // Stylised landscapes for Journal entries and the Daily Board: a sky gradient, a sun, hills or waves.
  const paint = (list) => page.evaluate(async (list) => {
    const { putBlob } = await import('./js/core/blobs.js');
    const P = {
      sunrise: [['#ffb36b', '#ff7e8a', '#6a5acd'], '#ffe28a', ['#3d3a7a', '#2b2a5c']],
      beach: [['#7ed3ff', '#bdeaff', '#fff1d0'], '#fff6c0', ['#2bb3c7', '#f4dca5']],
      forest: [['#c9f0d6', '#9fd9b4', '#e9f7d9'], '#fffbe0', ['#3f8f5a', '#2e6b43']],
      city: [['#2a2f6b', '#7b5ea7', '#f29b76'], '#ffd59e', ['#1d2045', '#141631']],
      mountain: [['#9cc8ff', '#d9e8ff', '#ffffff'], '#ffffff', ['#6b7fa8', '#3f4f73']],
      coffee: [['#f4e3cf', '#e8c9a6', '#d8b48c'], '#fff', ['#7a4b2a', '#4e2f19']],
    };
    for (const { key, kind, w = 900, h = 600 } of list) {
      const c = new OffscreenCanvas(w, h), g = c.getContext('2d'), [sky, sun, land] = P[kind] || P.sunrise;
      const gr = g.createLinearGradient(0, 0, 0, h); sky.forEach((col, i) => gr.addColorStop(i / (sky.length - 1), col));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = sun; g.globalAlpha = 0.9; g.beginPath(); g.arc(w * 0.68, h * 0.42, h * 0.12, 0, 7); g.fill(); g.globalAlpha = 1;
      if (kind === 'coffee') {
        g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(w / 2, h * 0.58, w * 0.26, h * 0.3, 0, 0, 7); g.fill();
        g.fillStyle = land[0]; g.beginPath(); g.ellipse(w / 2, h * 0.56, w * 0.2, h * 0.22, 0, 0, 7); g.fill();
        g.strokeStyle = '#f6e7d4'; g.lineWidth = 10; g.beginPath(); g.moveTo(w / 2, h * 0.42); g.bezierCurveTo(w * 0.42, h * 0.5, w * 0.58, h * 0.58, w / 2, h * 0.68); g.stroke();
      } else if (kind === 'city') {
        for (let i = 0; i < 18; i++) { const bw = w / 18, bh = h * (0.18 + ((i * 37) % 11) / 30); g.fillStyle = land[i % 2]; g.fillRect(i * bw, h - bh, bw - 4, bh); g.fillStyle = '#ffd59e'; for (let y = h - bh + 14; y < h - 10; y += 22) if ((i + y) % 3) g.fillRect(i * bw + 8, y, 6, 8); }
      } else {
        land.forEach((col, k) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 10) g.lineTo(x, h * (0.62 + k * 0.12) + Math.sin(x / (kind === 'mountain' ? 60 : 120) + k * 2) * h * (kind === 'mountain' ? 0.12 : 0.05)); g.lineTo(w, h); g.fill(); });
      }
      await putBlob(key, await c.convertToBlob({ type: 'image/jpeg', quality: 0.86 }));
    }
  }, list);

  // ---------------------------------------------------------------- app data that needs the page (IndexedDB)
  // Samsung Music: tagged WAV files (quiet, small) and album covers drawn here, imported through the app's own importer.
  const importMusic = () => page.evaluate(async () => {
    const L = await import('./js/music/library.js');
    const albums = [
      ['Golden Hour', 'Mara Sol', 'Pop', ['#ff9a5a', '#ff4f7b'], ['Sunlit', 'Paper Boats', 'Morning Tide']],
      ['Night Shift', 'Neon Coast', 'Electronic', ['#5b2bd6', '#16c2d8'], ['City Lights', 'Last Train', 'Afterglow']],
      ['Open Roads', 'The Wanderers', 'Indie', ['#2bb673', '#e7d84a'], ['Highway Song', 'Northbound']],
      ['Quiet Rooms', 'Lena Hart', 'Acoustic', ['#c9a27e', '#5d4037'], ['Rain on Glass', 'Slow Sunday']],
    ];
    const wav = (secs, info) => {
      const rate = 4000, n = rate * secs, enc = new TextEncoder();
      const subs = Object.entries(info).map(([k, v]) => { let b = enc.encode(v + '\0'); if (b.length & 1) b = new Uint8Array([...b, 0]); const hd = new Uint8Array(8); hd.set(enc.encode(k)); new DataView(hd.buffer).setUint32(4, b.length, true); return [hd, b]; }).flat();
      const listLen = 4 + subs.reduce((a, b) => a + b.length, 0), buf = new Uint8Array(44 + 8 + listLen + n), dv = new DataView(buf.buffer);
      let o = 0; const str = (s) => { buf.set(enc.encode(s), o); o += s.length; }, u32 = (v) => { dv.setUint32(o, v, true); o += 4; }, u16 = (v) => { dv.setUint16(o, v, true); o += 2; };
      str('RIFF'); u32(buf.length - 8); str('WAVE'); str('fmt '); u32(16); u16(1); u16(1); u32(rate); u32(rate); u16(1); u16(8);
      str('LIST'); u32(listLen); str('INFO'); for (const p of subs) { buf.set(p, o); o += p.length; }
      str('data'); u32(n); buf.fill(128, o);
      return buf;
    };
    const cover = async ([a, b], title) => {
      const c = new OffscreenCanvas(400, 400), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 400, 400);
      gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 400, 400);
      g.globalAlpha = 0.25; g.fillStyle = '#fff'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(80 + i * 70, 140 + (i % 2) * 120, 60 + i * 10, 0, 7); g.fill(); }
      g.globalAlpha = 1; g.fillStyle = '#fff'; g.font = '600 34px sans-serif'; g.fillText(title, 28, 360);
      return c.convertToBlob({ type: 'image/png' });
    };
    const items = [];
    for (const [album, artist, genre, cols, tracks] of albums) {
      const dir = `${artist}/${album}`;
      tracks.forEach((t, i) => items.push({ file: new File([wav(150 + ((t.length * 13) % 90), { INAM: t, IART: artist, IPRD: album, IGNR: genre, ITRK: String(i + 1) })], `${i + 1} ${t}.wav`, { type: 'audio/wav' }), path: `${dir}/${i + 1} ${t}.wav` }));
      items.push({ file: new File([await cover(cols, album)], 'cover.png', { type: 'image/png' }), path: `${dir}/cover.png` });
    }
    items.push({ file: new File(['[00:00.50]Golden light across the water\n[00:05.00]We follow it home\n[00:10.00]Every road is open\n[00:15.00]Nothing left to hold\n[00:20.00]Sing it with the morning\n'], '1 Sunlit.lrc', { type: 'text/plain' }), path: 'Mara Sol/Golden Hour/1 Sunlit.lrc' });
    await L.lib.ready?.();
    await L.importFiles(items);
    return L.lib.tracks().length;
  });

  // the Translator / LanguageDetector Chrome provides on the device, answered from a small phrase book
  const stubTranslator = () => page.evaluate(() => {
    const DICT = { 'Where is the nearest train station?': { es: '¿Dónde está la estación de tren más cercana?', ar: 'أين أقرب محطة قطار؟', fr: 'Où est la gare la plus proche ?', ko: '가장 가까운 기차역이 어디인가요?' },
      'Two coffees and a croissant, please.': { es: 'Dos cafés y un cruasán, por favor.', fr: 'Deux cafés et un croissant, s’il vous plaît.' },
      'Thank you so much!': { es: '¡Muchas gracias!', fr: 'Merci beaucoup !' } };
    window.Translator = { availability: async () => 'available', create: async ({ targetLanguage: b }) => ({ translate: async (x) => DICT[x]?.[b] ?? x, destroy() {} }) };
    window.LanguageDetector = { availability: async () => 'available', create: async () => ({ detect: async () => [{ detectedLanguage: 'en', confidence: 0.98 }], destroy() {} }) };
  });

  const peaks = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => Math.round(40 + 90 * Math.abs(Math.sin(i / 3 + seed) * Math.cos(i / 11 + seed * 2)) + ((i * 7919 + seed * 31) % 40)))).toString('base64');
  const recorder = { v: 1, cats: [{ id: 'k1', name: 'Lectures' }, { id: 'k2', name: 'Ideas' }], items: [
    { id: 'v1', title: 'Team meeting', at: at(0, 9, 32), mode: 'interview', dur: 1124, mime: 'audio/webm', size: 2.1e6, pk: peaks(200, 1), pk2: peaks(200, 2), pr: 0.2, marks: [{ t: 95, name: 'Launch date' }, { t: 640 }] },
    { id: 'v2', title: 'Song idea', at: at(-1, 22, 5), mode: 'std', dur: 74, mime: 'audio/webm', size: 1.4e5, cat: 'k2', pk: peaks(150, 3), pr: 2 },
    { id: 'v3', title: 'Design lecture', at: at(-2, 14), mode: 'stt', dur: 2710, mime: 'audio/webm', size: 5.2e6, cat: 'k1', pk: peaks(200, 4), pr: 0.07, text: [{ t: 0, s: 'Good design is as little design as possible.' }, { t: 6, s: 'Today we look at how simple layouts guide the eye.' }] },
    { id: 'v4', title: 'Voice memo', at: at(-4, 8, 41), mode: 'std', dur: 42, mime: 'audio/webm', size: 8e4, pk: peaks(84, 5), pr: 2 },
    { id: 'v5', title: 'Interview with Lina', at: at(-6, 16, 20), mode: 'interview', dur: 1820, mime: 'audio/webm', size: 3.4e6, pk: peaks(200, 6), pk2: peaks(200, 7), pr: 0.1 },
  ] };
  const journal = {
    journals: [{ id: 'journal', name: '', color: '#7b61ff' }, { id: 'jt', name: 'Travel', color: '#22a356' }, { id: 'jw', name: 'Work', color: '#3e7bff' }],
    entries: [
      { id: 'je1', created: at(0, 8, 10), at: at(0, 8, 10), title: 'Sunrise run', text: 'Woke up before the alarm and ran along the river. The light on the water was unreal — I want to remember mornings like this.', media: [{ id: 'journal:sunrise', k: 'photo' }], mood: { level: 5, feelings: ['happy', 'grateful'] }, place: 'Riverside', tags: ['running'], bookmark: true },
      { id: 'je2', created: at(-1, 21, 40), at: at(-1, 21, 40), text: 'Dinner with Sam and Lea. We talked about Lisbon until the restaurant closed.', moment: { kind: 'event', at: at(-1, 19), title: 'Dinner with Sam and Lea', sub: '19:00 – 21:30', color: '#f97316' }, mood: { level: 4 } },
      { id: 'je3', created: at(-2, 18, 30), at: at(-2, 18, 30), journal: 'jt', title: 'Planning Lisbon', text: 'Booked the little hotel in Alfama with the blue tiles. Day one: tram 28, the viewpoints, then the beach.', media: [{ id: 'journal:beach', k: 'photo' }, { id: 'journal:city', k: 'photo' }], tags: ['travel'] },
      { id: 'je4', created: at(-3, 13, 5), at: at(-3, 13, 5), title: 'Lunch-break walk', text: 'Forty minutes under the trees in the park. No phone, just the leaves turning.', media: [{ id: 'journal:forest', k: 'photo' }], mood: { level: 4, feelings: ['calm'] } },
      { id: 'je5', created: at(-5, 17, 50), at: at(-5, 17, 50), journal: 'jw', title: 'Shipped the beta', text: 'The team pulled it off. Small bugs, big smiles. Celebrate the small wins more often.', mood: { level: 5, feelings: ['proud'] } },
      { id: 'je6', created: at(-8, 9), at: at(-8, 9), title: 'Latte art, attempt #12', text: 'Almost a heart this time.', media: [{ id: 'journal:coffee', k: 'photo' }], mood: { level: 3 } },
      { id: 'je7', created: at(-12, 19), at: at(-12, 19), journal: 'jt', title: 'Weekend in the hills', text: 'Fog in the morning, sun by noon, and the best apple pie.', media: [{ id: 'journal:mountain', k: 'photo' }], mood: { level: 4 } },
    ],
    prefs: {},
  };
  const journalPics = ['sunrise', 'beach', 'city', 'forest', 'coffee', 'mountain'].map((k) => ({ key: 'journal:' + k, kind: k }));
  const nt = (id, x, y, w, h, c, tx) => ({ id, t: 'note', x, y, w, h, c, tx });
  const canvasBoard = { id: 'b1', name: 'Launch plan', created: T - 6 * D, at: T - 2 * H, fav: true, grid: true, scenes: [], items: [
    { id: 'tt', t: 'text', x: 60, y: 30, w: 520, h: 60, tx: 'Product launch 🚀', fs: 40, b: true },
    { id: 'sh1', t: 'shape', k: 'rect', rad: 26, x: 60, y: 130, w: 260, h: 120, fill: '#dbeafe', st: '#3e7bff', sw: 3, tx: 'Research', fs: 24, b: true, col: '#1e3a8a' },
    { id: 'sh2', t: 'shape', k: 'rect', rad: 26, x: 420, y: 130, w: 260, h: 120, fill: '#dcfce7', st: '#22a356', sw: 3, tx: 'Design', fs: 24, b: true, col: '#14532d' },
    { id: 'sh3', t: 'shape', k: 'rect', rad: 26, x: 780, y: 130, w: 260, h: 120, fill: '#fce7f3', st: '#e2589c', sw: 3, tx: 'Launch', fs: 24, b: true, col: '#831843' },
    { id: 'l1', t: 'line', a: { id: 'sh1', s: 'e' }, b: { id: 'sh2', s: 'w' }, k: 's', hb: 1, st: '#64748b', sw: 3 },
    { id: 'l2', t: 'line', a: { id: 'sh2', s: 'e' }, b: { id: 'sh3', s: 'w' }, k: 's', hb: 1, st: '#64748b', sw: 3 },
    nt('n1', 60, 310, 220, 200, 'yellow', 'Talk to 10 users this week'),
    nt('n2', 300, 330, 220, 200, 'pink', 'New onboarding screens'),
    nt('n3', 560, 310, 220, 200, 'blue', 'Icon set + dark mode'),
    nt('n4', 800, 330, 220, 200, 'green', 'Launch day: Thursday 10:00'),
    { id: 'st', t: 'shape', k: 'star', n: 5, x: 1060, y: 300, w: 140, h: 140, fill: '#ffd60a', st: '#f59e0b', sw: 3 },
    { id: 'ov', t: 'shape', k: 'oval', x: 1060, y: 470, w: 160, h: 90, fill: '#ede9fe', st: '#7b61ff', sw: 3, tx: 'Party!', fs: 20, b: true, col: '#4c1d95' },
  ] };
  const wbDays = (() => {
    const SITES = ['docs.google.com', 'github.com', 'youtube.com', 'en.wikipedia.org', 'news.ycombinator.com', 'figma.com', 'netflix.com'], days = {};
    for (let i = -13; i <= 0; i++) {
      const s = {}, hh = {};
      SITES.forEach((site, j) => {
        const sec = Math.round((2400 - j * 280 + (((i + 20) * 7 + j * 13) % 9) * 160) * (i === 0 ? 0.55 : 1));
        if ((i + j) % 6 === 5) return;
        const key = site === 'en.wikipedia.org' ? 'wikipedia.org' : site;
        s[key] = sec;
        const hr = i === 0 ? 8 + (j % 3) : 9 + j;
        (hh[hr] ||= {})[key] = sec;
      });
      days[dk(i)] = { s, h: hh, n: 18 + ((i + 14) % 7), u: 6 + ((i + 14) % 4), f: 0, fh: '' };
    }
    return days;
  })();
  const games = { stats: { sudoku: { played: 24, won: 21, run: 6, bestRun: 9 }, minesweeper: { played: 31, won: 18 }, solitaire: { played: 15, won: 9 }, chess: { played: 8, won: 5 }, g2048: { played: 12, won: 3, max: { tile: 2048, score: 26412 } } },
    daily: { sudoku: { [dk(-1)]: { won: true, ms: 380000 }, [dk(-2)]: { won: true, ms: 410000 }, [dk(-3)]: { won: true, ms: 351000 } }, minesweeper: { [dk(0)]: { won: true, ms: 95000 }, [dk(-1)]: { won: true, ms: 120000 } } },
    saves: {}, ach: { 'first-win': T - 9 * D, 'sudoku-5': T - 3 * D }, prefs: {}, profile: { name: 'Alex' } };

  // ---------------------------------------------------------------- scenes
  const blur = () => page.evaluate(() => document.activeElement?.blur());
  const app = async (id, params, wait = 1200) => { await openApp(id, params); await sleep(wait); await blur(); };
  const hide = (sel) => page.evaluate((s) => document.querySelectorAll(s).forEach((n) => n.remove()), sel);
  const scenes = {
    async lock() {
      await start({ locked: true, data: { timers } });
      await sleep(1500);
      await shot('01-lock');
    },
    async lock2() {
      await start({ locked: true, settings: { theme: 'dark', clockStyle: 'classic', clockFont: 'serif', wallpaper: { type: 'preset', id: 'aurora' }, lockWidgets: ['weather', 'event', 'battery'] } });
      await sleep(1500);
      await shot('01b-lock-style');
    },
    async home() {
      await start();
      await shot('02-home');
    },
    async brief() {
      await start();
      await go('./js/shell/brief.js', 'openBrief', { kind: 'morning' });
      await sleep(1200);
      await shot('03-brief');
    },
    async qp() {
      await start({ data: { timers } });
      await go('./js/shell/quickpanel.js', 'openQuickPanel', { expanded: false });
      await sleep(1000); await blur();
      await shot('05-quick-panel');
    },
    async finder() {
      await start();
      await go('./js/shell/finder.js', 'openFinder', 'lunch with Sara Friday 1pm');
      await sleep(1200);
      await shot('06-finder-command');
      await go('./js/shell/finder.js', 'closeFinder');
      await sleep(400);
      await go('./js/shell/finder.js', 'openFinder', 'lisbon');
      await sleep(1200);
      await shot('06b-finder-search');
    },
    async apps() {
      await start();
      await go('./js/shell/drawer.js', 'openDrawer');
      await sleep(1000);
      await shot('07-apps-screen');
    },
    async edge() {
      await start();
      await go('./js/shell/edge.js', 'openEdge');
      await sleep(900);
      await shot('08-edge-panel');
    },
    async windows() {
      await start({ data: { appWindows: { notes: { x: 50, y: 70, w: 470, h: 660 }, weather: { x: 470, y: 110, w: 420, h: 640 }, calculator: { x: 880, y: 160, w: 300, h: 540 } } } });
      await app('notes', { id: 'n1' }, 900); await app('weather', null, 900); await app('calculator', null, 900);
      await page.keyboard.type('1250*12%'); await sleep(500);
      await shot('09-multi-window');
    },
    async split() {
      await start();
      await go('./js/core/apps.js', 'splitApp', 'notes', 'l'); await sleep(900);
      await go('./js/core/apps.js', 'splitApp', 'calendar', 'r'); await sleep(1200); await blur();
      await shot('10-split-screen');
    },
    async recents() {
      await start();
      await app('notes', { id: 'n1' }, 700); await app('calendar', null, 700); await app('weather', null, 700); await app('health', null, 700);
      await go('./js/shell/recents.js', 'openRecents');
      await sleep(1400);
      await shot('11-recents');
    },
    async weather() {
      await start();
      await app('weather', null, 1800);
      await shot('12-weather');
      await start({ max: ['weather'] });
      await app('weather', null, 1800);
      await shot('12b-weather-full');
    },

    async calendar() {
      await start();
      await app('calendar', { view: 'month' }, 1200);
      await shot('13-calendar-month');
      await app('calendar', { view: 'week' }, 1200);
      await shot('13b-calendar-week');
    },
    async notes() {
      await start();
      await app('notes', { id: 'n1' }, 1500);
      await shot('14-notes');
    },
    async reminder() {
      await start();
      await app('reminder', null, 1200);
      await shot('15-reminder');
    },
    async clock() {
      await start({ data: { timers } });
      await app('clock', { tab: 'world' }, 1500);
      await shot('16-clock-world');
      await app('clock', { tab: 'alarm' }, 1000);
      await shot('16b-clock-alarm');
    },
    async calculator() {
      await start({ data: { calc: { history: [{ expr: '1250×12%', result: '150' }, { expr: '48÷3', result: '16' }] } } });
      await app('calculator', null, 1000);
      await page.keyboard.type('(36+14)*2.5'); await sleep(500);
      await shot('17-calculator');
    },
    async health() {
      await start({ max: ['health'] });
      await app('health', null, 1500);
      await shot('18-health');
      await app('health', { section: 'activity' }, 1500);
      await shot('18b-health-activity');
    },

    async wallet() {
      await start();
      await app('wallet', null, 1500);
      await shot('19-wallet');
      await app('wallet', { section: 'pass:p-flight' }, 1500);
      await shot('19b-wallet-pass');
    },
    async contacts() {
      await start({ max: ['contacts'] });
      await app('contacts', { id: 'c1' }, 1500);
      await shot('20-contacts');
    },

    async journal() {
      await start({ data: { journal }, max: ['journal'] });
      await paint(journalPics);
      await app('journal', null, 1800);
      await shot('21-journal');
    },

    async games() {
      await start({ data: { games }, max: ['games'] });
      // the achievement banners the seeded stats earn would cover the header
      await app('games', null, 1500);
      await hide('.gm-banner');
      await shot('22-games');
      await app('games', { section: 'sudoku' }, 1500);
      await hide('.gm-banner');
      await shot('22b-sudoku');
    },

    async music() {
      await start({ max: ['music'] });
      console.log('  tracks imported:', await importMusic());
      await app('music', { tab: 'albums' }, 1800);
      await shot('23-music');
      await go('./js/music/player.js', 'playSource', 'tracks', null);
      await sleep(1500);
      await app('music', { full: true }, 1800);
      await shot('23b-music-player');
      await page.evaluate(() => import('./js/music/player.js').then((m) => m.music?.pause?.())).catch(() => {});
    },

    async canvas() {
      await start({ data: { canvas: [canvasBoard] }, max: ['canvas'] });
      await app('canvas', { id: 'b1' }, 2000);
      await shot('24-canvas');
    },

    async interpreter() {
      await start();
      await stubTranslator();
      await app('interpreter', { tab: 'text', text: 'Where is the nearest train station?' }, 2000);
      await shot('25-interpreter');
      // a tablet-sized window: the two cards side by side, with text big enough for a store tile
      await start({ data: { appWindows: { interpreter: { x: 190, y: 90, w: 900, h: 600 } } } });
      await stubTranslator();
      await app('interpreter', { tab: 'text', text: 'Where is the nearest train station?' }, 2000);
      await shot('25m-interpreter');
    },

    async recorder() {
      await start({ data: { recorder } });
      await app('recorder', { section: 'list' }, 1500);
      await shot('26-recorder');
      await start({ data: { recorder }, max: ['recorder'] });
      await app('recorder', { section: 'list' }, 1500);
      await shot('26m-recorder');
    },

    async routines() {
      await start();
      await app('routines', null, 1500);
      await shot('27-routines');
      await start({ max: ['routines'] });
      await app('routines', null, 1500);
      await shot('27m-routines');
    },

    async wellbeing() {
      // with the tabs permission there is no "Allow access" card; this profile doesn't have it, so the card is removed
      await start({ data: { wellbeing: { setup: true, goal: 240, timers: [{ id: 'tm1', kind: 'site', target: 'youtube.com', min: 30, days: null, on: true }] }, wellbeingUsage: { days: wbDays, g: {} } }, max: ['wellbeing'] });
      await app('wellbeing', null, 1800);
      await hide('.wb-perm');
      await shot('28-wellbeing');
    },

    async store() {
      await start();
      await app('store', null, 2200);
      await shot('29-galaxy-store');
      await start({ max: ['store'] });
      await app('store', null, 2200);
      await shot('29m-galaxy-store');
    },

    async settings() {
      await start({ settings: { profileName: 'Alex Morgan' } });
      await app('settings', null, 1200);
      await shot('30-settings');
      await app('settings', { page: 'wallpaper' }, 1800);
      await shot('30b-wallpaper');
      await start({ settings: { profileName: 'Alex Morgan' }, max: ['settings'] });
      await app('settings', null, 1200);
      await shot('30m-settings');
      await app('settings', { page: 'wallpaper' }, 1800);
      await shot('30mb-wallpaper');
    },

    async dark() {
      await start({ settings: { theme: 'dark', iconStyle: 'themed', wallpaper: { type: 'preset', id: 'midnight' } } });
      await shot('31-home-dark');
    },
    async darkapp() {
      await start({ settings: { theme: 'dark', wallpaper: { type: 'preset', id: 'midnight' } } });
      await app('calendar', { view: 'month' }, 1400);
      await shot('37-dark-calendar');
    },
    async pin() {
      await start();
      await go('./js/shell/pin.js', 'setPin', '123456');
      await go('./js/shell/lock.js', 'lockNow');
      await sleep(800);
      await page.keyboard.press('Enter'); await sleep(900);
      await page.keyboard.type('12'); await sleep(400);
      await shot('32-pin');
    },
    async dailyboard() {
      await start({ data: { dailyBoard: { source: 'photos', photos: ['p1', 'p2'], page: 'photo', night: false } } });
      await paint([{ key: 'dailyboard:p1', kind: 'mountain', w: 1600, h: 1000 }, { key: 'dailyboard:p2', kind: 'beach', w: 1600, h: 1000 }]);
      await go('./js/shell/dailyboard.js', 'openDailyBoard');
      await sleep(2200);
      await shot('33-daily-board');
      for (const n of ['b', 'c', 'd']) { await page.keyboard.press('ArrowRight'); await sleep(1300); await shot('33' + n + '-daily-board'); }
    },

    async arabic() {
      const dubai = { name: 'دبي', lat: 25.2, lon: 55.27 };
      await start({ settings: { lang: 'ar' }, place: dubai, fc: forecast({ base: 29, amp: 4, now: { temperature_2m: 31.4, weather_code: 0, apparent_temperature: 33 } }) });
      await shot('34-arabic-home');
      await app('calendar', { view: 'month' }, 1400);
      await shot('34b-arabic-calendar');
    },
    async sidepanel() {
      await start();
      await page.setViewport({ width: 420, height: 800 });
      await page.goto(ctx.url.replace('newtab.html', 'sidepanel.html'));
      await sleep(2000);
      await shot('35-side-panel');
      await page.evaluate(() => [...document.querySelectorAll('[data-tab], .sp-tab, nav button')].find((b) => /reminder/i.test(b.dataset.tab || b.textContent))?.click());
      await sleep(1200);
      await shot('35b-side-panel');
      await page.setViewport({ width: 1280, height: 800 });
    },


  };

  for (const [name, fn] of Object.entries(scenes)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    try { await fn(); ok(true, 'scene ' + name); } catch (e) { ok(false, 'scene ' + name + ': ' + e.message); }
  }
};
