// Unit conversions for the Calculator's Unit converter and Finder ("5 km to mi", "10 كم إلى ميل"), ported from Liquid
// Tab's js/calc/units.js. Each unit has a factor to its category's base unit (or [to base, from base] functions).
// Names come from Intl when it knows the unit, otherwise from the strings below; symbols are the international ones
// ("km", "°F", "MB") in every language, as Samsung's converter shows them, so Finder answers read the same in Arabic.
// Currency is left out on purpose: live exchange rates would need a network service.
import { addStrings, t, locale, lang } from '../core/i18n.js';
import { latinDigits } from './engine.js';

// id, factor | [to base, from base], Intl unit (or null), symbol
const U = (id, f, intl, sym) => ({ id, f, intl, sym });
export const CATEGORIES = [
  { id: 'area', units: [
    U('square-kilometer', 1e6, null, 'km²'), U('hectare', 1e4, 'hectare', 'ha'), U('are', 100, null, 'a'), U('square-meter', 1, null, 'm²'),
    U('square-centimeter', 1e-4, null, 'cm²'), U('square-millimeter', 1e-6, null, 'mm²'), U('square-mile', 2589988.110336, null, 'mi²'),
    U('acre', 4046.8564224, 'acre', 'ac'), U('square-yard', 0.83612736, null, 'yd²'), U('square-foot', 0.09290304, null, 'ft²'), U('square-inch', 0.00064516, null, 'in²')] },
  { id: 'length', units: [
    U('kilometer', 1e3, 'kilometer', 'km'), U('meter', 1, 'meter', 'm'), U('centimeter', 0.01, 'centimeter', 'cm'), U('millimeter', 0.001, 'millimeter', 'mm'),
    U('micrometer', 1e-6, null, 'μm'), U('nanometer', 1e-9, null, 'nm'), U('mile', 1609.344, 'mile', 'mi'), U('yard', 0.9144, 'yard', 'yd'),
    U('foot', 0.3048, 'foot', 'ft'), U('inch', 0.0254, 'inch', 'in'), U('nautical-mile', 1852, null, 'nmi'),
    U('light-year', 9.4607304725808e15, null, 'ly')] },
  { id: 'temperature', units: [
    U('celsius', [(v) => v, (v) => v], 'celsius', '°C'), U('fahrenheit', [(v) => ((v - 32) * 5) / 9, (v) => (v * 9) / 5 + 32], 'fahrenheit', '°F'),
    U('kelvin', [(v) => v - 273.15, (v) => v + 273.15], null, 'K')] },
  { id: 'volume', units: [
    U('milliliter', 0.001, 'milliliter', 'mL'), U('liter', 1, 'liter', 'L'), U('cubic-meter', 1000, null, 'm³'), U('cubic-centimeter', 0.001, null, 'cm³'),
    U('gallon', 3.785411784, 'gallon', 'gal'), U('gallon-imperial', 4.54609, null, 'gal (UK)'), U('quart', 0.946352946, null, 'qt'), U('pint', 0.473176473, null, 'pt'),
    U('cup', 0.2365882365, null, 'cup'), U('fluid-ounce', 0.0295735295625, 'fluid-ounce', 'fl oz'), U('tablespoon', 0.01478676478125, null, 'tbsp'),
    U('teaspoon', 0.00492892159375, null, 'tsp'), U('cubic-inch', 0.016387064, null, 'in³'), U('cubic-foot', 28.316846592, null, 'ft³')] },
  // Samsung calls this category "Mass"; the id stays Liquid Tab's
  { id: 'weight', units: [
    U('kilogram', 1, 'kilogram', 'kg'), U('gram', 0.001, 'gram', 'g'), U('milligram', 1e-6, null, 'mg'), U('metric-ton', 1000, null, 't'),
    U('pound', 0.45359237, 'pound', 'lb'), U('ounce', 0.028349523125, 'ounce', 'oz'), U('stone', 6.35029318, 'stone', 'st'), U('short-ton', 907.18474, null, 'ton (US)'),
    U('long-ton', 1016.0469088, null, 'ton (UK)'), U('carat', 0.0002, null, 'ct')] },
  { id: 'data', units: [
    U('bit', 0.125, 'bit', 'bit'), U('kilobit', 125, 'kilobit', 'kb'), U('megabit', 125e3, 'megabit', 'Mb'), U('gigabit', 125e6, 'gigabit', 'Gb'), U('terabit', 125e9, 'terabit', 'Tb'),
    U('byte', 1, 'byte', 'B'), U('kilobyte', 1e3, 'kilobyte', 'kB'), U('megabyte', 1e6, 'megabyte', 'MB'), U('gigabyte', 1e9, 'gigabyte', 'GB'), U('terabyte', 1e12, 'terabyte', 'TB'),
    U('petabyte', 1e15, 'petabyte', 'PB'), U('kibibyte', 1024, null, 'KiB'), U('mebibyte', 1024 ** 2, null, 'MiB'), U('gibibyte', 1024 ** 3, null, 'GiB')] },
  { id: 'speed', units: [
    U('meter-per-second', 1, 'meter-per-second', 'm/s'), U('kilometer-per-hour', 1 / 3.6, 'kilometer-per-hour', 'km/h'), U('mile-per-hour', 0.44704, 'mile-per-hour', 'mph'),
    U('foot-per-second', 0.3048, null, 'ft/s'), U('knot', 1852 / 3600, null, 'kn')] },
  { id: 'time', units: [
    U('nanosecond', 1e-9, 'nanosecond', 'ns'), U('microsecond', 1e-6, 'microsecond', 'μs'), U('millisecond', 0.001, 'millisecond', 'ms'), U('second', 1, 'second', 's'),
    U('minute', 60, 'minute', 'min'), U('hour', 3600, 'hour', 'h'), U('day', 86400, 'day', 'd'), U('week', 604800, 'week', 'wk'), U('month', 2629746, 'month', 'mo'),
    U('year', 31556952, 'year', 'yr')] },
  // Not in Samsung's converter, kept for Finder ("1 bar to psi") and for parity with Liquid Tab
  { id: 'angle', extra: true, units: [
    U('degree', 1, 'degree', '°'), U('radian', 180 / Math.PI, null, 'rad'), U('gradian', 0.9, null, 'grad'), U('arcminute', 1 / 60, null, '′'), U('arcsecond', 1 / 3600, null, '″'),
    U('revolution', 360, null, 'rev')] },
  { id: 'energy', extra: true, units: [
    U('joule', 1, null, 'J'), U('kilojoule', 1e3, null, 'kJ'), U('calorie', 4.184, null, 'cal'), U('kilocalorie', 4184, null, 'kcal'), U('watt-hour', 3600, null, 'Wh'),
    U('kilowatt-hour', 3.6e6, null, 'kWh'), U('electronvolt', 1.602176634e-19, null, 'eV'), U('btu', 1055.05585262, null, 'BTU')] },
  { id: 'force', extra: true, units: [
    U('newton', 1, null, 'N'), U('kilonewton', 1e3, null, 'kN'), U('pound-force', 4.4482216152605, null, 'lbf'), U('kilogram-force', 9.80665, null, 'kgf'), U('dyne', 1e-5, null, 'dyn')] },
  // base: kilometres per litre; litres per 100 km is the inverse
  { id: 'fuel', extra: true, units: [
    U('liter-per-100-kilometer', [(v) => 100 / v, (v) => 100 / v], null, 'L/100 km'), U('kilometer-per-liter', 1, 'kilometer-per-liter', 'km/L'),
    U('mile-per-gallon', 1.609344 / 3.785411784, 'mile-per-gallon', 'mpg'), U('mile-per-gallon-imperial', 1.609344 / 4.54609, null, 'mpg (UK)')] },
  { id: 'power', extra: true, units: [
    U('watt', 1, null, 'W'), U('kilowatt', 1e3, null, 'kW'), U('megawatt', 1e6, null, 'MW'), U('horsepower', 745.69987158227, null, 'hp'), U('btu-per-hour', 0.29307107017, null, 'BTU/h')] },
  { id: 'pressure', extra: true, units: [
    U('pascal', 1, null, 'Pa'), U('hectopascal', 100, null, 'hPa'), U('kilopascal', 1e3, null, 'kPa'), U('megapascal', 1e6, null, 'MPa'), U('bar', 1e5, null, 'bar'),
    U('millibar', 100, null, 'mbar'), U('atmosphere', 101325, null, 'atm'), U('psi', 6894.757293168, null, 'psi'), U('mmhg', 133.322387415, null, 'mmHg'), U('inhg', 3386.388640341, null, 'inHg')] },
];

/** The two units the converter starts with in each category. */
export const DEFAULTS = { area: ['square-meter', 'square-foot'], length: ['kilometer', 'mile'], temperature: ['celsius', 'fahrenheit'], volume: ['liter', 'gallon'],
  weight: ['kilogram', 'pound'], data: ['megabyte', 'gigabyte'], speed: ['kilometer-per-hour', 'mile-per-hour'], time: ['hour', 'minute'], angle: ['degree', 'radian'],
  energy: ['kilocalorie', 'kilojoule'], force: ['newton', 'pound-force'], fuel: ['liter-per-100-kilometer', 'mile-per-gallon'], power: ['kilowatt', 'horsepower'], pressure: ['bar', 'psi'] };

const byId = new Map();
for (const c of CATEGORIES) for (const u of c.units) { u.cat = c.id; byId.set(u.id, u); }
export const unit = (id) => byId.get(id);
export const category = (id) => CATEGORIES.find((c) => c.id === id);
export const unitCategory = (id) => byId.get(id)?.cat || null;

/** Converts `v` from one unit id to another of the same category. NaN when they don't match. */
export function convert(v, from, to) {
  const a = byId.get(from), b = byId.get(to);
  if (!a || !b || a.cat !== b.cat) return NaN;
  const base = Array.isArray(a.f) ? a.f[0](v) : v * a.f;
  return Array.isArray(b.f) ? b.f[1](base) : base / b.f;
}

// ——— names ———
const intlName = (unitId, n) => {
  try {
    return new Intl.NumberFormat(locale(), { style: 'unit', unit: unitId, unitDisplay: 'long' }).formatToParts(n).filter((p) => p.type === 'unit').map((p) => p.value).join('').trim();
  } catch {
    return '';
  }
};
const cap = (s) => (s ? s[0].toLocaleUpperCase(locale()) + s.slice(1) : s);
/** Short international symbol: "km", "°C", "m²". */
export const unitSymbol = (id) => byId.get(id)?.sym || id;
/** Full name for lists: "Kilometers", "Square feet". Arabic uses the singular (plurals change the word). */
export function unitName(id) {
  const u = byId.get(id);
  if (!u) return id;
  if (u.intl) {
    const n = intlName(u.intl, lang() === 'ar' ? 1 : 2);
    if (n) return cap(n);
  }
  return t('calc.u.' + id);
}
export const categoryName = (id) => t('calc.cat.' + id);

// ——— typed conversions ———
// Every symbol, id and English name (with common spellings), plus the Arabic words people type.
const ALIASES = {
  meter: 'm metre metres meters متر امتار أمتار', kilometer: 'km kms kilometre kilometres kilometers كم كيلو كيلومتر كيلومترات كلم',
  centimeter: 'cm centimetre centimetres centimeters سم سنتيمتر سنتي', millimeter: 'mm millimetre millimetres millimeters مم ملم مليمتر', mile: 'mi miles ميل اميال أميال',
  yard: 'yd yds yards يارده ياردة', foot: 'ft feet foot قدم اقدام أقدام', inch: 'in inch inches بوصه بوصة انش إنش', 'nautical-mile': 'nmi', 'light-year': 'ly lightyear lightyears',
  micrometer: 'um micron microns', nanometer: 'nm nanometers',
  gram: 'g gr grams غ غرام جرام جم', kilogram: 'kg kgs kilo kilos kilograms كغ كجم كيلوغرام كيلوجرام', milligram: 'mg milligrams ملغ مجم', pound: 'lb lbs pounds رطل ارطال باوند',
  ounce: 'oz ounces اونصه أونصة', stone: 'st stones', 'metric-ton': 't tonne tonnes طن', 'short-ton': 'ton tons', 'long-ton': 'long ton', carat: 'ct carats قيراط',
  milliliter: 'ml millilitre millilitres milliliters مل ملل', liter: 'l litre litres liters ltr لتر لترات', gallon: 'gal gallons جالون غالون', 'fluid-ounce': 'floz fl oz',
  cup: 'cups كوب اكواب', tablespoon: 'tbsp tablespoons', teaspoon: 'tsp teaspoons', pint: 'pt pints', quart: 'qt quarts', 'cubic-meter': 'm3 m³', 'cubic-centimeter': 'cc cm3 cm³',
  celsius: 'c °c degc centigrade مئوية سيليزي سلزيوس', fahrenheit: 'f °f degf فهرنهايت', kelvin: 'k كلفن',
  'kilometer-per-hour': 'km/h kmh kph كم/س', 'mile-per-hour': 'mph', 'meter-per-second': 'm/s mps', knot: 'kn kt knots عقده', 'foot-per-second': 'ft/s fps',
  byte: 'b bytes بايت', kilobyte: 'kb kilobytes كيلوبايت', megabyte: 'mb megabytes ميجابايت ميغابايت', gigabyte: 'gb gigabytes جيجابايت غيغابايت', terabyte: 'tb terabytes تيرابايت', petabyte: 'pb',
  bit: 'bits', kibibyte: 'kib', mebibyte: 'mib', gibibyte: 'gib',
  second: 's sec secs seconds ثانيه ثانية ثواني', minute: 'min mins minutes دقيقه دقيقة دقائق', hour: 'h hr hrs hours ساعه ساعة ساعات', day: 'd days يوم ايام أيام',
  week: 'wk weeks اسبوع أسبوع اسابيع', month: 'months شهر اشهر أشهر', year: 'yr yrs years سنه سنة سنوات عام', millisecond: 'ms milliseconds',
  degree: 'deg degrees ° درجه درجة', radian: 'rad rads radians', 'square-meter': 'm2 sqm', 'square-foot': 'ft2 sqft sq ft', 'square-kilometer': 'km2 sq km', acre: 'acres فدان', hectare: 'ha hectares هكتار',
  are: 'ares آر', calorie: 'cal calories سعره سعرة', kilocalorie: 'kcal', joule: 'j joules جول', 'kilowatt-hour': 'kwh', watt: 'w watts واط', kilowatt: 'kw', horsepower: 'hp حصان',
  pascal: 'pa', bar: 'bars', atmosphere: 'atm', psi: 'psi', mmhg: 'mmhg', 'liter-per-100-kilometer': 'l/100km', 'mile-per-gallon': 'mpg', 'kilometer-per-liter': 'km/l kmpl',
};
let aliasMap;
function aliases() {
  if (aliasMap) return aliasMap;
  aliasMap = new Map();
  const add = (k, id) => {
    k = k.toLowerCase().replace(/\s+/g, ' ').trim();
    if (k && !aliasMap.has(k)) aliasMap.set(k, id);
  };
  add('fl oz', 'fluid-ounce');
  add('sq ft', 'square-foot');
  for (const [id, words] of Object.entries(ALIASES)) for (const w of words.split(' ')) add(w, id);
  for (const u of byId.values()) {
    add(u.id, u.id);
    add(u.id.replace(/-/g, ' '), u.id);
    add(u.sym, u.id);
  }
  return aliasMap;
}
// Arabic letters are matched without hamza/ta-marbuta differences: "درجة" = "درجه"
const foldUnit = (w) => String(w).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/^ال(?=\p{L}{2})/u, '').replace(/\s+/g, ' ').trim();
/** A unit id from what someone typed ("km", "Kilometers", "°F", "كيلومتر", or its name in the UI language), or null. */
export function findUnit(word) {
  const m = aliases();
  const w = String(word).toLowerCase().replace(/\s+/g, ' ').trim();
  const hit = m.get(w) || m.get(foldUnit(w)) || m.get(w.replace(/s$/, ''));
  if (hit) return hit;
  for (const u of byId.values()) if (unitName(u.id).toLowerCase() === w) return u.id;
  return null;
}

// "to"-words need a space after them; "=" and arrows don't; Arabic writes "in"/"to" on the unit ("بالميل", "للميل")
const SEP = '(?:(?:into|to|in|as|إلى|الى|في)\\s+|(?:=|->|→)\\s*|(?:بال|لل|ل)(?=\\p{L}))';
/** "5 km to mi", "100 f in c", "10 كم إلى ميل" → { value, from, to, result } or null. */
export function parseConversion(text) {
  const s = latinDigits(String(text)).replace(/٫/g, '.').trim();
  const m = s.match(new RegExp(`^(-?[\\d.,]+)\\s*(.+?)\\s+${SEP}(.+?)\\s*=?\\s*\\??$`, 'iu'));
  if (!m) return null;
  const value = parseFloat(m[1].replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  const from = findUnit(m[2]), to = findUnit(m[3]);
  if (isNaN(value) || !from || !to || from === to || byId.get(from).cat !== byId.get(to).cat) return null;
  return { value, from, to, result: convert(value, from, to) };
}

// Names of the categories and of the units Intl doesn't know (Arabic wording from Liquid Tab where it had one).
addStrings({
  en: {
    'calc.cat.area': 'Area', 'calc.cat.length': 'Length', 'calc.cat.temperature': 'Temperature', 'calc.cat.volume': 'Volume', 'calc.cat.weight': 'Mass',
    'calc.cat.data': 'Data', 'calc.cat.speed': 'Speed', 'calc.cat.time': 'Time', 'calc.cat.angle': 'Angle', 'calc.cat.energy': 'Energy', 'calc.cat.force': 'Force',
    'calc.cat.fuel': 'Fuel economy', 'calc.cat.power': 'Power', 'calc.cat.pressure': 'Pressure',
    'calc.u.square-kilometer': 'Square kilometers', 'calc.u.are': 'Ares', 'calc.u.square-meter': 'Square meters', 'calc.u.square-centimeter': 'Square centimeters',
    'calc.u.square-millimeter': 'Square millimeters', 'calc.u.square-mile': 'Square miles', 'calc.u.square-yard': 'Square yards', 'calc.u.square-foot': 'Square feet',
    'calc.u.square-inch': 'Square inches', 'calc.u.micrometer': 'Micrometers', 'calc.u.nanometer': 'Nanometers', 'calc.u.nautical-mile': 'Nautical miles',
    'calc.u.light-year': 'Light-years', 'calc.u.kelvin': 'Kelvin', 'calc.u.cubic-meter': 'Cubic meters', 'calc.u.cubic-centimeter': 'Cubic centimeters',
    'calc.u.gallon-imperial': 'UK gallons', 'calc.u.quart': 'Quarts', 'calc.u.pint': 'Pints', 'calc.u.cup': 'Cups', 'calc.u.tablespoon': 'Tablespoons',
    'calc.u.teaspoon': 'Teaspoons', 'calc.u.cubic-inch': 'Cubic inches', 'calc.u.cubic-foot': 'Cubic feet', 'calc.u.milligram': 'Milligrams', 'calc.u.metric-ton': 'Tonnes',
    'calc.u.short-ton': 'US tons', 'calc.u.long-ton': 'UK tons', 'calc.u.carat': 'Carats', 'calc.u.kibibyte': 'Kibibytes', 'calc.u.mebibyte': 'Mebibytes',
    'calc.u.gibibyte': 'Gibibytes', 'calc.u.foot-per-second': 'Feet per second', 'calc.u.knot': 'Knots', 'calc.u.radian': 'Radians', 'calc.u.gradian': 'Gradians',
    'calc.u.arcminute': 'Arcminutes', 'calc.u.arcsecond': 'Arcseconds', 'calc.u.revolution': 'Revolutions', 'calc.u.joule': 'Joules', 'calc.u.kilojoule': 'Kilojoules',
    'calc.u.calorie': 'Calories', 'calc.u.kilocalorie': 'Kilocalories', 'calc.u.watt-hour': 'Watt-hours', 'calc.u.kilowatt-hour': 'Kilowatt-hours',
    'calc.u.electronvolt': 'Electronvolts', 'calc.u.btu': 'British thermal units', 'calc.u.newton': 'Newtons', 'calc.u.kilonewton': 'Kilonewtons',
    'calc.u.pound-force': 'Pound-force', 'calc.u.kilogram-force': 'Kilogram-force', 'calc.u.dyne': 'Dynes', 'calc.u.liter-per-100-kilometer': 'Liters per 100 kilometers',
    'calc.u.mile-per-gallon-imperial': 'Miles per UK gallon', 'calc.u.watt': 'Watts', 'calc.u.kilowatt': 'Kilowatts', 'calc.u.megawatt': 'Megawatts',
    'calc.u.horsepower': 'Horsepower', 'calc.u.btu-per-hour': 'BTU per hour', 'calc.u.pascal': 'Pascals', 'calc.u.hectopascal': 'Hectopascals',
    'calc.u.kilopascal': 'Kilopascals', 'calc.u.megapascal': 'Megapascals', 'calc.u.bar': 'Bars', 'calc.u.millibar': 'Millibars', 'calc.u.atmosphere': 'Atmospheres',
    'calc.u.psi': 'Pounds per square inch', 'calc.u.mmhg': 'Millimeters of mercury', 'calc.u.inhg': 'Inches of mercury',
  },
  ar: {
    'calc.cat.area': 'المساحة', 'calc.cat.length': 'الطول', 'calc.cat.temperature': 'درجة الحرارة', 'calc.cat.volume': 'الحجم', 'calc.cat.weight': 'الكتلة',
    'calc.cat.data': 'البيانات', 'calc.cat.speed': 'السرعة', 'calc.cat.time': 'الوقت', 'calc.cat.angle': 'الزاوية', 'calc.cat.energy': 'الطاقة', 'calc.cat.force': 'القوة',
    'calc.cat.fuel': 'استهلاك الوقود', 'calc.cat.power': 'القدرة', 'calc.cat.pressure': 'الضغط',
    'calc.u.square-kilometer': 'كيلومترات مربعة', 'calc.u.are': 'آر', 'calc.u.square-meter': 'أمتار مربعة', 'calc.u.square-centimeter': 'سنتيمترات مربعة',
    'calc.u.square-millimeter': 'مليمترات مربعة', 'calc.u.square-mile': 'أميال مربعة', 'calc.u.square-yard': 'ياردات مربعة', 'calc.u.square-foot': 'أقدام مربعة',
    'calc.u.square-inch': 'بوصات مربعة', 'calc.u.micrometer': 'ميكرومترات', 'calc.u.nanometer': 'نانومترات', 'calc.u.nautical-mile': 'أميال بحرية',
    'calc.u.light-year': 'سنوات ضوئية', 'calc.u.kelvin': 'كلفن', 'calc.u.cubic-meter': 'أمتار مكعبة', 'calc.u.cubic-centimeter': 'سنتيمترات مكعبة',
    'calc.u.gallon-imperial': 'غالونات بريطانية', 'calc.u.quart': 'كوارتات', 'calc.u.pint': 'باينتات', 'calc.u.cup': 'أكواب', 'calc.u.tablespoon': 'ملاعق كبيرة',
    'calc.u.teaspoon': 'ملاعق صغيرة', 'calc.u.cubic-inch': 'بوصات مكعبة', 'calc.u.cubic-foot': 'أقدام مكعبة', 'calc.u.milligram': 'مليغرامات', 'calc.u.metric-ton': 'أطنان مترية',
    'calc.u.short-ton': 'أطنان أمريكية', 'calc.u.long-ton': 'أطنان بريطانية', 'calc.u.carat': 'قيراطات', 'calc.u.kibibyte': 'كيبيبايت', 'calc.u.mebibyte': 'ميبيبايت',
    'calc.u.gibibyte': 'جيبيبايت', 'calc.u.foot-per-second': 'أقدام في الثانية', 'calc.u.knot': 'عُقد', 'calc.u.radian': 'راديان', 'calc.u.gradian': 'غراد',
    'calc.u.arcminute': 'دقائق قوسية', 'calc.u.arcsecond': 'ثوانٍ قوسية', 'calc.u.revolution': 'دورات', 'calc.u.joule': 'جول', 'calc.u.kilojoule': 'كيلوجول',
    'calc.u.calorie': 'سعرات', 'calc.u.kilocalorie': 'كيلو سعرات', 'calc.u.watt-hour': 'واط ساعة', 'calc.u.kilowatt-hour': 'كيلوواط ساعة',
    'calc.u.electronvolt': 'إلكترون فولت', 'calc.u.btu': 'وحدات حرارية بريطانية', 'calc.u.newton': 'نيوتن', 'calc.u.kilonewton': 'كيلو نيوتن',
    'calc.u.pound-force': 'رطل قوة', 'calc.u.kilogram-force': 'كيلوغرام قوة', 'calc.u.dyne': 'داين', 'calc.u.liter-per-100-kilometer': 'لتر لكل 100 كيلومتر',
    'calc.u.mile-per-gallon-imperial': 'ميل لكل غالون بريطاني', 'calc.u.watt': 'واط', 'calc.u.kilowatt': 'كيلوواط', 'calc.u.megawatt': 'ميغاواط',
    'calc.u.horsepower': 'قدرة حصانية', 'calc.u.btu-per-hour': 'BTU في الساعة', 'calc.u.pascal': 'باسكال', 'calc.u.hectopascal': 'هكتوباسكال',
    'calc.u.kilopascal': 'كيلوباسكال', 'calc.u.megapascal': 'ميغاباسكال', 'calc.u.bar': 'بار', 'calc.u.millibar': 'مليبار', 'calc.u.atmosphere': 'ضغط جوي',
    'calc.u.psi': 'رطل لكل بوصة مربعة', 'calc.u.mmhg': 'مليمترات زئبق', 'calc.u.inhg': 'بوصات زئبق',
  },
});
