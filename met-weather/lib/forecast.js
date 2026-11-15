/**
 * Pure forecast rules for the MET Locationforecast compact document.
 * Norway only. Hours are counted from the timeseries step at or just before now.
 */

export const PREFIX = '/api/extensions/met-weather';
export const TIME_ZONE = 'Europe/Oslo';
export const HOUR_MS = 60 * 60 * 1000;

const COMPASS_NB = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];
const COMPASS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const ICONS = {
  clearsky: 'sun',
  fair: 'cloud-sun',
  partlycloudy: 'cloud-sun',
  cloudy: 'cloud',
  fog: 'cloud',
  lightrain: 'cloud-drizzle',
  rain: 'cloud-rain',
  heavyrain: 'cloud-rain',
  lightrainshowers: 'cloud-drizzle',
  rainshowers: 'cloud-rain',
  heavyrainshowers: 'cloud-rain',
  lightsleet: 'cloud-rain',
  sleet: 'cloud-rain',
  heavysleet: 'cloud-rain',
  lightsleetshowers: 'cloud-rain',
  sleetshowers: 'cloud-rain',
  heavysleetshowers: 'cloud-rain',
  lightsnow: 'cloud-snow',
  snow: 'cloud-snow',
  heavysnow: 'cloud-snow',
  lightsnowshowers: 'cloud-snow',
  snowshowers: 'cloud-snow',
  heavysnowshowers: 'cloud-snow',
};

export function roundCoord(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 10000) / 10000;
}

/** Mainland, Svalbard, Bjørnøya and Jan Mayen. A backstop behind the place register. */
export function inNorway(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const mainland = lat >= 57.9 && lat <= 71.4 && lon >= 4.4 && lon <= 31.3;
  const svalbard = lat >= 74 && lat <= 81 && lon >= 10 && lon <= 35;
  const janMayen = lat >= 70.8 && lat <= 71.2 && lon >= -9.2 && lon <= -7.8;
  return mainland || svalbard || janMayen;
}

export function symbolKey(code) {
  return String(code || '').replace(/_(day|night|polartwilight)$/, '') || 'unknown';
}

export function symbolIcon(code) {
  const night = /_night$/.test(String(code || ''));
  const key = symbolKey(code);
  if (night && (key === 'clearsky' || key === 'fair')) return 'moon';
  if (night && key === 'partlycloudy') return 'cloud-moon';
  if (key.includes('thunder')) return 'cloud-lightning';
  return ICONS[key] || 'cloud';
}

export function compass(degrees, locale) {
  if (!Number.isFinite(degrees)) return '';
  const dirs = locale === 'nb' ? COMPASS_NB : COMPASS_EN;
  const index = ((Math.round(Number(degrees) / 45) % 8) + 8) % 8;
  return dirs[index];
}

export function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * (10 ** digits)) / (10 ** digits);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(digits);
}

function precipitation(entry) {
  const hour = entry?.data?.next_1_hours?.details?.precipitation_amount;
  if (Number.isFinite(hour)) return { amount: hour, span: 1 };
  const six = entry?.data?.next_6_hours?.details?.precipitation_amount;
  if (Number.isFinite(six)) return { amount: six, span: 6 };
  return { amount: 0, span: 1 };
}

function parseEntry(entry) {
  const time = entry?.time;
  const instant = entry?.data?.instant?.details || {};
  const stamp = Date.parse(time);
  if (!Number.isFinite(stamp) || !Number.isFinite(instant.air_temperature)) return null;
  const precip = precipitation(entry);
  const symbol = entry?.data?.next_1_hours?.summary?.symbol_code
    || entry?.data?.next_6_hours?.summary?.symbol_code
    || entry?.data?.next_12_hours?.summary?.symbol_code
    || '';
  return {
    time,
    temp: instant.air_temperature,
    precip: precip.amount,
    precipSpan: precip.span,
    wind: Number.isFinite(instant.wind_speed) ? instant.wind_speed : null,
    direction: Number.isFinite(instant.wind_from_direction) ? instant.wind_from_direction : null,
    humidity: Number.isFinite(instant.relative_humidity) ? instant.relative_humidity : null,
    symbol,
  };
}

/** Up to `hours` of forecast beginning at the step that covers `now`. */
export function forecastFromMet(doc, now = new Date(), hours = 48) {
  const series = Array.isArray(doc?.properties?.timeseries) ? doc.properties.timeseries : [];
  const parsed = series.map(parseEntry).filter(Boolean);
  if (!parsed.length) return { current: null, hours: [] };
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  let anchorIndex = 0;
  for (let index = 0; index < parsed.length; index += 1) {
    if (Date.parse(parsed[index].time) <= nowMs) anchorIndex = index;
    else break;
  }
  const anchor = Date.parse(parsed[anchorIndex].time);
  const end = anchor + hours * HOUR_MS;
  const window = parsed.filter((point) => {
    const stamp = Date.parse(point.time);
    return stamp >= anchor && stamp < end;
  });
  return { current: window[0] || null, hours: window };
}

export function sliceHours(hours, days) {
  const list = Array.isArray(hours) ? hours : [];
  if (!list.length) return [];
  const span = days === 1 ? 24 : 48;
  const anchor = Date.parse(list[0].time);
  const end = anchor + span * HOUR_MS;
  return list.filter((point) => Date.parse(point.time) < end);
}

export function extent(hours) {
  const temps = hours.map((point) => point.temp).filter(Number.isFinite);
  const precips = hours.map((point) => point.precip).filter(Number.isFinite);
  if (!temps.length) return { low: null, high: null, precip: 0 };
  return {
    low: Math.min(...temps),
    high: Math.max(...temps),
    precip: precips.reduce((sum, value) => sum + value, 0),
  };
}

/**
 * Positions for the temperature line and precipitation bars.
 * Temperature uses the left side of the plot. Precipitation grows up from the base.
 */
export function layoutChart(points, box = {}) {
  const width = box.width || 640;
  const height = box.height || 240;
  const pad = { l: 40, r: 16, t: 16, b: 32, ...box.pad };
  const temps = points.map((point) => point.temp).filter(Number.isFinite);
  let tMin = temps.length ? Math.min(...temps) : 0;
  let tMax = temps.length ? Math.max(...temps) : 1;
  if (tMax - tMin < 1) {
    tMin -= 1;
    tMax += 1;
  }
  const pMax = Math.max(1, ...points.map((point) => (Number.isFinite(point.precip) ? point.precip : 0)));
  const innerW = Math.max(1, width - pad.l - pad.r);
  const innerH = Math.max(1, height - pad.t - pad.b);
  const slot = points.length > 0 ? innerW / points.length : innerW;
  const barW = Math.max(1, slot * 0.62);
  const xAt = (index) => pad.l + slot * index + slot / 2;
  const yTemp = (temp) => pad.t + (1 - (temp - tMin) / (tMax - tMin)) * innerH;
  const base = pad.t + innerH;
  const marks = points.map((point, index) => {
    const precip = Number.isFinite(point.precip) ? point.precip : 0;
    const precipH = (precip / pMax) * innerH;
    return {
      x: xAt(index),
      tempY: yTemp(point.temp),
      barX: xAt(index) - barW / 2,
      barY: base - precipH,
      barW,
      barH: precipH,
    };
  });
  return { width, height, pad, tMin, tMax, pMax, base, slot, marks };
}
